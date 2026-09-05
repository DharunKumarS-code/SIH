// Topology validation engine orchestrator (Phase 7). Loads the requested
// scope from Mongo, runs every deterministic rule module, and assembles a
// validation run result. This is the ONLY place that talks to the database
// or the ai-service geometry engine — every rules/*.js module is a pure
// function over already-fetched docs, which is what makes them independently
// unit-testable (see backend/tests/topology.test.js).

import { db } from '../../store/index.js'
import { outerRing, distanceToRingM } from '../gnss/geomUtils.js'
import { analyzePolygons, polygonPairs } from './geometryClient.js'
import { candidatePairs } from './spatialIndex.js'
import { makeFinding, summarize } from './result.js'
import { STATUS } from './severity.js'
import { TOPOLOGY_CONFIG, TOPOLOGY_DISCLAIMER, ML_DECISION_NOTE } from './tolerances.js'
import * as parcelRules from './rules/parcelRules.js'
import * as buildingRules from './rules/buildingRules.js'
import * as floorRules from './rules/floorRules.js'
import * as unitRules from './rules/unitRules.js'
import * as volumeRules from './rules/volumeRules.js'

let runSeq = Date.now() % 1_000_000
const nextRunId = () => {
  runSeq += 1
  return `TRUN-${Date.now().toString(36).toUpperCase()}-${String(runSeq).padStart(6, '0')}`
}

/** Minimum ring-to-ring distance (metres), sampled from each ring's own vertices against the other ring — exact for the axis-aligned demo footprints, a safe approximation for arbitrary simple polygons. */
function ringGapDistanceM(ringA, ringB) {
  let best = Infinity
  for (const pt of ringA) {
    const { distanceM } = distanceToRingM(pt, ringB)
    if (distanceM < best) best = distanceM
  }
  for (const pt of ringB) {
    const { distanceM } = distanceToRingM(pt, ringA)
    if (distanceM < best) best = distanceM
  }
  return Number.isFinite(best) ? best : null
}

async function loadScope({ localities, ulpin, buildingId, floorId, propertyId } = {}) {
  const parcelFilter = {}
  if (localities) parcelFilter.locality = { $in: localities }
  if (ulpin) parcelFilter.ulpin = ulpin

  let parcels = await db.collection('parcels').find(parcelFilter)
  if (buildingId || floorId || propertyId) {
    // narrow to the single parcel that owns the requested building/floor/unit
    const b = buildingId
      ? await db.collection('buildings').findOne({ buildingId })
      : floorId
        ? await db.collection('buildings').findOne({ buildingId: (await db.collection('floors').findOne({ floorId }))?.buildingId })
        : await db.collection('buildings').findOne({ buildingId: (await db.collection('propertyUnits').findOne({ propertyId }))?.buildingId })
    parcels = b ? await db.collection('parcels').find({ ulpin: b.ulpin }) : []
  }

  const ulpins = parcels.map((p) => p.ulpin)
  const [buildings, floors, units] = await Promise.all([
    db.collection('buildings').find({ ulpin: { $in: ulpins } }),
    db.collection('floors').find({ ulpin: { $in: ulpins } }),
    db.collection('propertyUnits').find({ ulpin: { $in: ulpins } }),
  ])
  return { parcels, buildings, floors, units }
}

/**
 * Run the full deterministic rule engine over a scope of already-loaded docs.
 * Pure (besides the geometry-engine HTTP calls) — no DB writes here.
 */
export async function evaluate({ parcels, buildings, floors, units }) {
  const findings = []

  // ---- one shared geometry-engine round-trip for every intrinsic polygon check ----
  const polygons = []
  for (const p of parcels) { const ring = outerRing(p.geometry); if (ring) polygons.push({ id: `parcel:${p.parcelId || p.ulpin}`, ring }) }
  for (const b of buildings) { const ring = outerRing(b.geometry); if (ring) polygons.push({ id: `building:${b.buildingId}`, ring }) }
  const geomById = await analyzePolygons(polygons)

  // ---- parcel ----
  findings.push(...parcelRules.validateParcelGeometry(parcels, geomById))
  const parcelPairs = candidatePairs(parcels, (p) => outerRing(p.geometry), TOPOLOGY_CONFIG.gapCandidateRadiusM)
  const parcelOverlapPairs = parcelPairs.filter(([a, b]) => {
    const ra = outerRing(a.geometry); const rb = outerRing(b.geometry)
    return ra && rb
  })
  const parcelPairBatch = parcelOverlapPairs.map(([a, b]) => ({
    idA: a.parcelId || a.ulpin, idB: b.parcelId || b.ulpin, ringA: outerRing(a.geometry), ringB: outerRing(b.geometry),
  }))
  const parcelPairMetrics = await polygonPairs(parcelPairBatch)
  findings.push(...parcelRules.validateParcelOverlaps(parcelOverlapPairs, parcelPairMetrics))
  findings.push(...parcelRules.validateParcelGaps(parcelOverlapPairs, (a, b) => {
    const key = `${a.parcelId || a.ulpin}::${b.parcelId || b.ulpin}`
    const m = parcelPairMetrics.get(key)
    if (m?.intersects) return 0 // overlapping, not gapped — OVERLAPPING_PARCELS already covers it
    const ra = outerRing(a.geometry); const rb = outerRing(b.geometry)
    return ra && rb ? ringGapDistanceM(ra, rb) : null
  }))

  // ---- building ----
  const parcelsById = new Map(parcels.map((p) => [p.ulpin, p]))
  findings.push(...buildingRules.validateBuildingGeometry(buildings, geomById))
  findings.push(...buildingRules.validateBuildingParcelContainment(buildings, parcelsById))
  const buildingPairs = candidatePairs(buildings, (b) => outerRing(b.geometry), 0)
  const buildingPairBatch = buildingPairs.map(([a, b]) => ({ idA: a.buildingId, idB: b.buildingId, ringA: outerRing(a.geometry), ringB: outerRing(b.geometry) }))
  const buildingPairMetrics = await polygonPairs(buildingPairBatch)
  findings.push(...buildingRules.validateBuildingOverlaps(buildingPairs, buildingPairMetrics))

  // ---- floor (per building) ----
  const buildingsById = new Map(buildings.map((b) => [b.buildingId, b]))
  findings.push(...floorRules.validateFloorElevation(floors, buildingsById))
  findings.push(...floorRules.validateFloorNotInBuilding(floors, buildingsById))
  const floorsByBuilding = new Map()
  for (const f of floors) {
    if (!floorsByBuilding.has(f.buildingId)) floorsByBuilding.set(f.buildingId, [])
    floorsByBuilding.get(f.buildingId).push(f)
  }
  for (const [buildingId, group] of floorsByBuilding) {
    const locality = group[0]?.locality
    findings.push(...floorRules.validateFloorStacking(buildingId, group, locality))
    findings.push(...floorRules.validateDuplicateFloors(buildingId, group, locality))
  }

  // ---- unit (per building) ----
  const floorsById = new Map(floors.map((f) => [f.floorId, f]))
  findings.push(...unitRules.validateUnitContainment(units, buildingsById, floorsById))
  findings.push(...unitRules.validateUnitArea(units))
  const unitsByBuilding = new Map()
  for (const u of units) {
    if (!unitsByBuilding.has(u.buildingId)) unitsByBuilding.set(u.buildingId, [])
    unitsByBuilding.get(u.buildingId).push(u)
  }
  for (const [buildingId, group] of unitsByBuilding) {
    const locality = group[0]?.locality
    findings.push(...unitRules.validateUnitOverlaps(buildingId, group, locality))
    findings.push(...unitRules.validateDuplicateUnits(buildingId, group, locality))
  }
  findings.push(...volumeRules.validateDisconnectedUnits(units, buildingsById))

  // ---- 3D volume (generic, across the whole assembled hierarchy) ----
  const volumes = volumeRules.assembleVolumes({ buildings, floors, units })
  findings.push(...volumeRules.validateVolumeIntrinsics(volumes))
  findings.push(...volumeRules.validateVolumeIntersections(volumes))
  findings.push(...volumeRules.validateDuplicateVolumes(volumes))

  const entityCounts = { PARCEL: parcels.length, BUILDING: buildings.length, FLOOR: floors.length, UNIT: units.length, VOLUME: volumes.length }
  const summary = summarize(findings, entityCounts)

  return { findings, summary }
}

/** Run + persist a validation over a scope, returning the stored run document. */
export async function runValidation({ scopeType, scopeId, localities } = {}, opts = {}) {
  const data = await loadScope({
    localities,
    ulpin: scopeType === 'parcel' ? scopeId : undefined,
    buildingId: scopeType === 'building' ? scopeId : undefined,
    floorId: scopeType === 'floor' ? scopeId : undefined,
    propertyId: scopeType === 'unit' ? scopeId : undefined,
  })

  const { findings, summary } = await evaluate(data)

  const doc = {
    validationRunId: nextRunId(),
    scopeType: scopeType || 'all',
    scopeId: scopeId || null,
    localities: localities || null,
    findings,
    summary,
    mlDecision: ML_DECISION_NOTE,
    disclaimer: TOPOLOGY_DISCLAIMER,
    requestedBy: opts.user?.username || null,
    createdAt: new Date().toISOString(),
    isDemo: true,
  }
  if (opts.persist !== false) await db.collection('topologyValidationResults').create(doc)
  return doc
}

export { STATUS }
