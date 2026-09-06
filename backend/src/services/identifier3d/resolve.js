// Phase 9 — resolve a Proposed 3D Property Identifier to the ACTUAL entities and
// geometry it references. This is a REFERENCE layer: it reuses the Phase-2
// volume model, Phase-5 elevation values, Phase-6 survey references, Phase-7
// validation and Phase-8 spatial relationships — it never recomputes any of them.

import { db } from '../../store/index.js'
import { unitVolume, floorVolume, buildingVolume, validateUnitVolume } from '../geometry3d/index.js'
import { demoProvenance } from '../landData/index.js'
import { listVersions, getVersion } from './versions.js'

/**
 * @param {object} parts  from parse.js: { officialULPIN, buildingSegment,
 *   buildingNumber, floorSegment, floorNumber, unitSegment, apartmentNumber,
 *   volumeId, geometryVersion }
 * @param {object} [opts]  { internalParcelRef } used only when officialULPIN is null
 */
export async function resolveHierarchy(parts, opts = {}) {
  const out = {
    officialULPIN: parts.officialULPIN || null,
    officialULPINStatus: null,
    officialULPINVerified: false,
    internalParcelRef: opts.internalParcelRef || null,
    parcel: null,
    building: null,
    floor: null,
    unit: null,
    volume: null,
    geometryVersion: null,
    geometryVersions: [],
    found: { parcel: false, building: false, floor: false, unit: false, volume: false, geometryVersion: false },
  }

  // ---- parcel resolution (Official ULPIN is NEVER fabricated) ----
  // The canonical's parcel key may be an Official ULPIN OR an internal
  // prototype parcel reference (spec section 6). Try both; also honour an
  // explicit internalParcelRef.
  let parcel = null
  let matchedByUlpin = false
  const parcelKey = parts.officialULPIN || opts.internalParcelRef || null
  if (parcelKey) {
    parcel = await db.collection('parcels').findOne({ ulpin: parcelKey })
    if (parcel) matchedByUlpin = true
    else parcel = await db.collection('parcels').findOne({ parcelId: parcelKey })
  }
  if (!parcel && opts.internalParcelRef && opts.internalParcelRef !== parcelKey) {
    parcel = await db.collection('parcels').findOne({ parcelId: opts.internalParcelRef })
  }
  if (parcel) {
    out.found.parcel = true
    const prov = demoProvenance(parcel)
    out.parcel = {
      ulpin: parcel.ulpin,
      parcelId: parcel.parcelId,
      locality: parcel.locality,
      landUse: parcel.landUse,
      geometry: parcel.geometry,
      verificationStatus: prov.verificationStatus,
      ulpinStatus: prov.ulpinStatus, // DEMO_NOT_OFFICIAL for every seeded parcel today
    }
    // The Official ULPIN keeps its OWN provenance — Phase 9 never upgrades it.
    // If the parcel was resolved via an internal reference (not by ULPIN), the
    // Official ULPIN is NOT AVAILABLE for display purposes.
    out.officialULPINStatus = matchedByUlpin ? prov.ulpinStatus : 'NOT_AVAILABLE'
    out.officialULPINVerified = matchedByUlpin && prov.ulpinStatus === 'OFFICIAL'
  } else if (parcelKey) {
    out.officialULPINStatus = 'UNRESOLVED'
  } else {
    out.officialULPINStatus = 'NOT_AVAILABLE'
  }

  // ---- building ----
  let building = null
  if (parcel) {
    building = await db.collection('buildings').findOne({ ulpin: parcel.ulpin, buildingSegment: parts.buildingSegment })
      || await db.collection('buildings').findOne({ ulpin: parcel.ulpin, buildingNumber: parts.buildingNumber })
  }
  if (building) {
    out.found.building = true
    out.building = {
      buildingId: building.buildingId,
      buildingSegment: building.buildingSegment,
      buildingNumber: building.buildingNumber,
      name: building.name,
      ulpin: building.ulpin,
      geometry: building.geometry,
      heightM: building.heightM,
      baseElevationM: building.baseElevationM,
      // Phase 5 references (never recomputed)
      elevationOverrideActive: building.elevationOverrideActive || false,
      elevationSource: building.elevationSource || null,
      elevationConfidenceLevel: building.elevationConfidenceLevel || null,
      volume: buildingVolume(building),
    }
  }

  // ---- floor ----
  let floor = null
  if (building) {
    floor = await db.collection('floors').findOne({ buildingId: building.buildingId, floorSegment: parts.floorSegment })
      || await db.collection('floors').findOne({ buildingId: building.buildingId, floorNumber: parts.floorNumber })
  }
  if (floor) {
    out.found.floor = true
    out.floor = {
      floorId: floor.floorId,
      floorSegment: floor.floorSegment,
      floorNumber: floor.floorNumber,
      label: floor.label,
      buildingId: floor.buildingId,
      baseHeight: floor.baseHeight,
      topHeight: floor.topHeight,
      volume: floorVolume(floor, building),
    }
  }

  // ---- unit ----
  let unit = null
  if (building) {
    const candidates = await db.collection('propertyUnits').find({
      buildingId: building.buildingId,
      ...(floor ? { floorId: floor.floorId } : { floorNumber: parts.floorNumber }),
    })
    unit = candidates.find((u) => String(u.apartmentNumber).toUpperCase() === parts.apartmentNumber)
      || candidates.find((u) => String(u.unitId).toUpperCase() === parts.unitSegment)
      || null
  }
  if (unit) {
    out.found.unit = true
    const vol = unitVolume(unit)
    const v2 = validateUnitVolume(unit, building)
    if (vol) vol.status = v2.status
    out.unit = {
      propertyId: unit.propertyId,
      unitId: unit.unitId,
      apartmentNumber: unit.apartmentNumber,
      buildingId: unit.buildingId,
      floorId: unit.floorId,
      floorNumber: unit.floorNumber,
      ulpin: unit.ulpin,
      usage: unit.usage,
      status: unit.status,
      geometry: unit.geometry,
      baseHeight: unit.baseHeight,
      topHeight: unit.topHeight,
      owner: unit.owner || null, // synthetic demo owner — NOT a legal ownership record
    }
    out.volume = vol
    out.found.volume = Boolean(vol)
    out.unitVolumeValidation = v2 // Phase-2 deterministic geometry validation (reused)
    // ---- volume id must match the identifier's component ----
    out.volumeIdMatches = Boolean(vol && vol.volumeId && vol.volumeId.toUpperCase() === parts.volumeId)
  }

  // ---- geometry version (referenced, immutable history preserved) ----
  // The Phase-2 volumeId (V<ff><nn>) is only unique WITHIN a building, so
  // geometry-version history is keyed to the globally-unique unit propertyId.
  // `geometryRef` on each version still carries the volumeId for display.
  if (out.unit?.propertyId) {
    const vers = await listVersions('VOLUME', out.unit.propertyId)
    out.geometryVersions = vers
    const match = await getVersion('VOLUME', out.unit.propertyId, parts.geometryVersion)
    out.geometryVersion = match || null
    out.found.geometryVersion = Boolean(match)
  }

  return out
}

/**
 * Phase-8 spatial relationships that touch this parcel/building. Exposed as a
 * relationship only — underground infrastructure is NEVER part of the property
 * hierarchy and a spatial intersection is NEVER ownership (spec section 18).
 */
export async function relatedUndergroundInfrastructure(resolved) {
  if (!resolved.parcel && !resolved.building) return []
  const filter = { locality: resolved.parcel?.locality }
  const rows = await db.collection('undergroundInfrastructure').find(filter)
  const out = []
  for (const r of rows) {
    const parcelHit = (r.parcelRelations || []).find((x) => x.parcelId === resolved.parcel?.parcelId)
    const buildingHit = (r.buildingRelations || []).find((x) => x.buildingId === resolved.building?.buildingId)
    if (parcelHit || buildingHit || r.parentParcel === resolved.parcel?.parcelId || r.parentBuilding === resolved.building?.buildingId) {
      out.push({
        infrastructureId: r.infrastructureId,
        type: r.type,
        spatialRelation: buildingHit?.spatialRelation || parcelHit?.spatialRelation || r.spatialRelation || 'NEAR_PARCEL',
        ownerAuthority: r.ownerAuthority || null,
        legalOwnership: r.legalOwnership || 'NOT_PROVIDED',
        note: 'Spatial relationship only — not part of the property identifier hierarchy and not an ownership claim.',
      })
    }
  }
  return out.slice(0, 20)
}

/** Phase-6 survey references carried by the unit / building geometry, if any. */
export async function surveyReferences(resolved) {
  const refs = {
    controlPointId: resolved.unit?.controlPointId || null,
    surveySessionId: resolved.unit?.surveySessionId || null,
    surveyMethod: resolved.unit?.surveyMethod || null,
    crs: 'EPSG:4326',
    verticalDatum: 'UNKNOWN',
    verificationStatus: 'UNVERIFIED',
    note: 'A control-point reference does not by itself make this identifier survey-authoritative.',
  }
  // If a GNSS control point is associated with this parcel, surface it as a
  // reference (Phase 6) — never as proof of accuracy.
  if (resolved.parcel?.ulpin) {
    const [cp] = await db.collection('gnssControlPoints').find(
      { parentULPIN: resolved.parcel.ulpin }, { sort: { createdAt: -1 }, limit: 1 },
    )
    if (cp) {
      refs.controlPointId = cp.controlPointId
      refs.crs = cp.coordinateReferenceSystem || refs.crs
      refs.verticalDatum = cp.verticalDatum || 'UNKNOWN'
      refs.surveyMethod = cp.surveyMethod || null
      refs.verificationStatus = cp.verificationStatus || 'UNVERIFIED'
    }
  }
  return refs
}
