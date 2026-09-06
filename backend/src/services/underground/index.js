// Phase 8 — underground 3D infrastructure mapping orchestrator (additive).
//
//   raw GeoJSON / CSV / JSON  ->  parse (parse.js)
//                             ->  CRS resolution (WGS84 pass-through, or a
//                                 pyproj transform via the SAME ai-service
//                                 endpoint Phase 6 already uses — never a
//                                 guessed CRS)
//                             ->  deterministic validation rules (validate.js —
//                                 REUSES the Phase 7 result model)
//                             ->  spatial association (associate.js — geometry
//                                 facts only, NEVER legal ownership)
//                             ->  Phase 5 elevation context (optional)
//                             ->  undergroundInfrastructure docs -> Mongo
//
// This module never fabricates: depth/elevation stay null when the source has
// no reliable Z (spec section 9); a source is never auto-promoted to official
// (spec section 4); a spatial intersection never becomes legal ownership
// (spec section 11).

import { db } from '../../store/index.js'
import { DEFAULT_LOCALITY_ID, getLocality, LOCALITIES } from '../../data/localities.js'
import { transformPoints, gnssConfig as fetchTransformConfig } from '../gnss/crsClient.js'
import {
  UNDERGROUND_CONFIG, UNDERGROUND_DISCLAIMER, ML_DECISION_NOTE, INFRA_TYPES,
  normaliseType, normaliseSource, deriveVerification, NEVER_AUTO_PROMOTE,
  LEGAL_OWNERSHIP_NOT_PROVIDED,
} from './config.js'
import { CORE_FIELDS, ParseError, parseInfrastructure } from './parse.js'
import { validateRecord, validateIntersections, summarize, STATUS } from './validate.js'
import { associate } from './associate.js'
import { geomShape, verticalBand, finite, distM, outerRing, pointToRingM } from './geometry.js'

export class UploadValidationError extends Error {}
export { UNDERGROUND_DISCLAIMER, ML_DECISION_NOTE }

export function validateUpload(file, { maxMb = 6 } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadValidationError('No file provided.')
  const mb = file.buffer.length / (1024 * 1024)
  if (mb > maxMb) throw new UploadValidationError(`File too large (${mb.toFixed(1)} MB > ${maxMb} MB limit).`)
  return { name: file.originalname || 'upload', sizeBytes: file.buffer.length }
}

let seq = Date.now() % 100000
const nextInfrastructureId = (type) => {
  seq += 1
  return `INF-UP-${normaliseType(type).replace(/_/g, '')}-${String(seq).padStart(6, '0')}`
}
const jobId = () => `INFJOB-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`

const localityCentres = () => LOCALITIES.map((l) => ({ id: l.id, lon: l.base.lon, lat: l.base.lat }))

const GEOGRAPHIC_CRS = new Set(['EPSG:4326', 'WGS84', 'WGS 84', '4326', 'CRS84', 'URN:OGC:DEF:CRS:OGC:1.3:CRS84'])
const isGeographicCrs = (crs) => {
  if (!crs) return null // unknown — never assumed
  return GEOGRAPHIC_CRS.has(String(crs).trim().toUpperCase())
}

/** GET /api/infrastructure/config */
export async function undergroundPipelineConfig() {
  const transform = await fetchTransformConfig().catch(() => null)
  return {
    pipeline: [
      'File input (GeoJSON / CSV / JSON)',
      'Field allowlist + geometry normalisation',
      'CRS resolution / transformation (pyproj via ai-service, never guessed)',
      'Deterministic validation (Phase 7 result model, extended)',
      'Spatial association (geometry facts only — never legal ownership)',
      'Phase 5 elevation context (optional)',
      '3D intersection / vertical-separation analysis',
      'Storage (undergroundInfrastructure)',
    ],
    infrastructureTypes: INFRA_TYPES,
    provenanceSources: ['OFFICIAL', 'AUTHORIZED', 'REAL_SURVEY', 'UPLOADED_SURVEY', 'DEMO', 'RESEARCH', 'UNVERIFIED', 'UNAVAILABLE'],
    neverAutoPromote: [...NEVER_AUTO_PROMOTE],
    spatialRelations: ['WITHIN_PARCEL', 'CROSSES_PARCEL', 'NEAR_PARCEL', 'UNDER_BUILDING', 'CROSSES_BUILDING', 'NEAR_BUILDING'],
    thresholds: UNDERGROUND_CONFIG,
    coreFields: CORE_FIELDS,
    transform, // null if the ai-service is unreachable — never fabricated
    mlDecision: ML_DECISION_NOTE,
    disclaimer: UNDERGROUND_DISCLAIMER,
  }
}

/**
 * Resolve every record's usable WGS84 geometry. No CRS or an explicit
 * geographic CRS => used as-is (crsStatus MATCHED/UNKNOWN). A projected CRS =>
 * transformed via the ai-service pyproj endpoint (crsStatus REPROJECTED), or
 * crsStatus TRANSFORMATION_FAILED when the service is unreachable — NEVER a
 * silent/guessed transform (spec section 15).
 */
async function resolveCrs(records, batchCrs) {
  const byCrs = new Map()
  records.forEach((rec, i) => {
    const crs = rec.crs || rec.inputCRS || batchCrs || null
    rec.inputCRS = crs
    const geo = isGeographicCrs(crs)
    if (geo === true) rec.crsStatus = 'MATCHED'
    else if (geo === null) rec.crsStatus = 'UNKNOWN'
    else {
      rec.crsStatus = 'PENDING'
      if (!byCrs.has(crs)) byCrs.set(crs, [])
      byCrs.get(crs).push(i)
    }
    rec.outputCRS = 'EPSG:4326'
  })

  for (const [crs, idxs] of byCrs) {
    // Flatten every vertex of every record declared in this CRS into one batch.
    const flat = []
    const map = [] // [recIdx, coordIdx, tuple ref]
    for (const i of idxs) {
      const shape = geomShape(records[i])
      if (!shape) { records[i].crsStatus = 'UNKNOWN'; continue }
      const coords = shape.kind === 'point' ? [shape.coord] : shape.kind === 'line' ? shape.coords : shape.ring
      coords.forEach((c, ci) => { map.push([i, ci]); flat.push({ x: c[0], y: c[1] }) })
    }
    if (!flat.length) continue
    const result = await transformPoints(flat, crs, 'EPSG:4326').catch(() => ({ status: 'UNKNOWN' }))
    if (result.status === 'REPROJECTED' && Array.isArray(result.points)) {
      map.forEach(([ri, ci], k) => {
        const p = result.points[k]
        if (!p || p.transformStatus !== 'OK') { records[ri].crsStatus = 'TRANSFORMATION_FAILED'; return }
        const shape = geomShape(records[ri])
        const coords = shape.kind === 'point' ? [shape.coord] : shape.kind === 'line' ? shape.coords : shape.ring
        coords[ci][0] = p.x
        coords[ci][1] = p.y
        if (records[ri].crsStatus === 'PENDING') records[ri].crsStatus = 'REPROJECTED'
      })
    } else if (result.status === 'MATCHED') {
      for (const i of idxs) if (records[i].crsStatus === 'PENDING') records[i].crsStatus = 'MATCHED'
    } else {
      for (const i of idxs) if (records[i].crsStatus === 'PENDING') records[i].crsStatus = 'TRANSFORMATION_FAILED'
    }
  }
  records.forEach((r) => { if (r.crsStatus === 'PENDING') r.crsStatus = 'TRANSFORMATION_FAILED' })
}

/** Depth model derivation (spec section 8): explicit, never a silent conversion. */
function depthModel(rec) {
  const band = verticalBand(rec)
  const out = {
    surfaceElevationM: finite(rec.surfaceElevationM) ? rec.surfaceElevationM : null,
    topElevationM: finite(rec.topElevationM) ? rec.topElevationM : (band ? Number(band.top.toFixed(3)) : null),
    bottomElevationM: finite(rec.bottomElevationM) ? rec.bottomElevationM : (band ? Number(band.bottom.toFixed(3)) : null),
    depthBelowSurfaceM: finite(rec.depthBelowSurfaceM) ? rec.depthBelowSurfaceM : null,
    depthReference: rec.depthReference || (finite(rec.depthBelowSurfaceM) ? 'GROUND_SURFACE' : 'UNKNOWN'),
    verticalDatum: rec.verticalDatum || 'UNKNOWN',
    verticalReference: rec.verticalReference || null,
    epoch: finite(rec.epoch) ? rec.epoch : (rec.epoch || null),
  }
  // TRUE DEPTH RULE (spec section 9): a real source with no reliable Z keeps
  // null depth/elevation and is marked for review.
  const isReal = ['OFFICIAL', 'AUTHORIZED', 'REAL_SURVEY', 'UPLOADED_SURVEY'].includes(rec.source)
  if (!band) {
    out.verticalStatus = 'UNKNOWN'
    out.reviewRequired = isReal ? true : Boolean(rec.reviewRequired)
  } else {
    out.verticalStatus = out.verticalDatum === 'UNKNOWN'
      ? (isReal ? 'KNOWN_RELATIVE' : 'DEMO')
      : 'KNOWN'
    out.reviewRequired = Boolean(rec.reviewRequired)
  }
  return out
}

async function localityData(locality) {
  const loc = getLocality(locality || DEFAULT_LOCALITY_ID)
  const [parcels, buildings] = await Promise.all([
    db.collection('parcels').find({ locality: loc.id }),
    db.collection('buildings').find({ locality: loc.id }),
  ])
  return { loc, parcels, buildings }
}

/** Shape a raw parsed row + resolved geometry into a full stored document. */
function toDocument(rec, { loc, parcels, buildings, batchCrs, sourceLabel, provenanceNote, user }) {
  const type = normaliseType(rec.type)
  const source = rec.source ? normaliseSource(rec.source) : normaliseSource(sourceLabel)
  const { verificationStatus, isOfficial } = deriveVerification(source)
  const depth = depthModel({ ...rec, source })
  const assoc = associate(rec, parcels, buildings)
  const now = new Date().toISOString()
  return {
    infrastructureId: rec.infrastructureId || nextInfrastructureId(type),
    type,
    subtype: rec.subtype || null,
    ownerAuthority: rec.ownerAuthority || null,
    status: rec.status || 'UNKNOWN',
    geometry: rec.geometry || null,
    // ---- provenance (NEVER auto-promoted) ----
    source,
    verificationStatus,
    isOfficial,
    provenanceNote: provenanceNote || rec.provenanceNote || null,
    timestamp: rec.timestamp || null,
    // ---- dimensions (only what was supplied) ----
    diameterM: finite(rec.diameterM) ? rec.diameterM : null,
    widthM: finite(rec.widthM) ? rec.widthM : null,
    heightM: finite(rec.heightM) ? rec.heightM : null,
    // ---- depth / vertical (explicit reference, never silently converted) ----
    ...depth,
    // ---- CRS ----
    inputCRS: rec.inputCRS || batchCrs || null,
    outputCRS: 'EPSG:4326',
    crsStatus: rec.crsStatus || 'UNKNOWN',
    horizontalDatum: rec.horizontalDatum || null,
    // ---- survey linkage (Phase 6) ----
    controlPointId: rec.controlPointId || null,
    surveySessionId: rec.surveySessionId || null,
    referenceStation: rec.referenceStation || null,
    surveyMethod: rec.surveyMethod || null,
    reportedAccuracyM: finite(rec.reportedAccuracyM) ? rec.reportedAccuracyM : null,
    // ---- spatial association (geometry facts only) ----
    spatialRelation: assoc.spatialRelation,
    parentParcel: assoc.parentParcel,
    parentParcelULPIN: assoc.parentParcelULPIN,
    parentBuilding: assoc.parentBuilding,
    parcelRelations: assoc.parcelRelations,
    buildingRelations: assoc.buildingRelations,
    // ---- legal ownership (only from authoritative data) ----
    legalOwnership: assoc.legalOwnership || LEGAL_OWNERSHIP_NOT_PROVIDED,
    // ---- misc ----
    confidence: finite(rec.confidence) ? rec.confidence : null,
    metadata: rec.notes ? { notes: rec.notes } : {},
    locality: loc.id,
    isDemo: !isOfficial,
    createdBy: user?.username || null,
    createdAt: now,
    disclaimer: UNDERGROUND_DISCLAIMER,
  }
}

/** Parse + validate a batch WITHOUT persisting (preview / dry-run). */
export async function parseAndValidate({ text, format, fieldMap, locality, batchCrs }) {
  let raw
  try {
    raw = parseInfrastructure(text, format, fieldMap)
  } catch (e) {
    if (e instanceof ParseError) throw new UploadValidationError(e.message)
    throw e
  }
  if (!raw.length) throw new UploadValidationError('No infrastructure records found in the uploaded file.')
  if (raw.length > UNDERGROUND_CONFIG.maxUploadFeatures) {
    throw new UploadValidationError(`Too many features (${raw.length} > ${UNDERGROUND_CONFIG.maxUploadFeatures}).`)
  }

  await resolveCrs(raw, batchCrs)
  const { loc, parcels, buildings } = await localityData(locality)
  const buildingsById = new Map(buildings.map((b) => [b.buildingId, b]))
  const ctx = { localityCentres: localityCentres(), buildingsById, batchCrs }

  const idCounts = new Map()
  raw.forEach((r) => { if (r.infrastructureId) idCounts.set(r.infrastructureId, (idCounts.get(r.infrastructureId) || 0) + 1) })

  const previews = raw.map((rec, i) => {
    const findings = validateRecord({ ...rec, source: rec.source ? normaliseSource(rec.source) : null }, ctx)
    if (rec.infrastructureId && idCounts.get(rec.infrastructureId) > 1) {
      findings.push({ ruleId: 'INF_DUPLICATE_ID', status: STATUS.ERROR, severity: 'HIGH', entityType: 'INFRASTRUCTURE', entityId: rec.infrastructureId, message: `infrastructureId "${rec.infrastructureId}" is used by ${idCounts.get(rec.infrastructureId)} rows in this batch.`, validationId: `IVFIND-DUP-${i}`, createdAt: new Date().toISOString(), provenance: rec.source || null, focusRef: null, relatedEntityId: null, geometry: null, suggestedFix: 'Give every record a unique infrastructureId.', computedValue: null, tolerance: null, locality: loc.id })
    }
    const assoc = associate(rec, parcels, buildings)
    const status = findings.reduce((s, f) => (['ERROR', 'REVIEW_REQUIRED', 'WARNING'].includes(f.status) ? worstOf(s, f.status) : s), STATUS.VALID)
    return {
      index: i,
      infrastructureId: rec.infrastructureId || '(auto-assigned on import)',
      type: normaliseType(rec.type),
      crsStatus: rec.crsStatus,
      spatialRelation: assoc.spatialRelation,
      verticalStatus: verticalBand(rec) ? 'RESOLVED' : 'UNKNOWN',
      validationStatus: status,
      findings,
    }
  })

  const intersectionFindings = validateIntersections(raw.map((r, i) => ({ ...r, infrastructureId: r.infrastructureId || `row#${i + 1}`, locality: loc.id })))

  const counts = { valid: 0, warning: 0, error: 0, reviewRequired: 0 }
  for (const p of previews) {
    if (p.validationStatus === 'ERROR') counts.error += 1
    else if (p.validationStatus === 'WARNING') counts.warning += 1
    else if (p.validationStatus === 'REVIEW_REQUIRED') counts.reviewRequired += 1
    else counts.valid += 1
  }

  return {
    locality: loc.id,
    records: previews,
    intersectionFindings,
    counts,
    overallStatus: counts.error ? 'ERROR' : counts.reviewRequired ? 'REVIEW_REQUIRED' : counts.warning ? 'WARNING' : 'VALID',
    disclaimer: UNDERGROUND_DISCLAIMER,
  }
}

const RANK = { VALID: 0, WARNING: 1, REVIEW_REQUIRED: 2, ERROR: 3 }
const worstOf = (a, b) => (RANK[b] > RANK[a] ? b : a)

/** Parse, validate, associate and PERSIST every record + a job summary. */
export async function importInfrastructure({ text, format, fieldMap, locality, sourceLabel, provenanceNote, batchCrs, user }) {
  let raw
  try {
    raw = parseInfrastructure(text, format, fieldMap)
  } catch (e) {
    if (e instanceof ParseError) throw new UploadValidationError(e.message)
    throw e
  }
  if (!raw.length) throw new UploadValidationError('No infrastructure records found in the uploaded file.')
  if (raw.length > UNDERGROUND_CONFIG.maxUploadFeatures) {
    throw new UploadValidationError(`Too many features (${raw.length} > ${UNDERGROUND_CONFIG.maxUploadFeatures}).`)
  }

  await resolveCrs(raw, batchCrs)
  const { loc, parcels, buildings } = await localityData(locality)
  const jid = jobId()
  const now = new Date().toISOString()

  await db.collection('infrastructureJobs').create({
    jobId: jid, kind: 'underground-infrastructure', status: 'PROCESSING', locality: loc.id,
    recordCount: raw.length, requestedBy: user?.username || null, createdAt: now,
    sourceLabel: normaliseSource(sourceLabel), disclaimer: UNDERGROUND_DISCLAIMER,
  })

  const stored = []
  for (const rec of raw) {
    const doc = toDocument(rec, { loc, parcels, buildings, batchCrs, sourceLabel, provenanceNote, user })
    await db.collection('undergroundInfrastructure').create(doc)
    stored.push(doc)
  }

  const summary = {
    total: stored.length,
    byType: countBy(stored, 'type'),
    bySource: countBy(stored, 'source'),
    official: stored.filter((d) => d.isOfficial).length,
    demo: stored.filter((d) => !d.isOfficial).length,
    depthUnknown: stored.filter((d) => d.verticalStatus === 'UNKNOWN').length,
    crsUnknown: stored.filter((d) => d.crsStatus === 'UNKNOWN' || d.crsStatus === 'TRANSFORMATION_FAILED').length,
  }
  await db.collection('infrastructureJobs').updateOne({ jobId: jid }, { status: 'COMPLETED', completedAt: new Date().toISOString(), summary })

  return { jobId: jid, status: 'COMPLETED', locality: loc.id, infrastructure: stored, summary, disclaimer: UNDERGROUND_DISCLAIMER }
}

function countBy(rows, key) {
  const m = {}
  for (const r of rows) m[r[key]] = (m[r[key]] || 0) + 1
  return m
}

let runSeq = Date.now() % 1_000_000
const nextRunId = () => {
  runSeq += 1
  return `IVRUN-${Date.now().toString(36).toUpperCase()}-${String(runSeq).padStart(6, '0')}`
}

/** Run + persist a deterministic validation over a scope of stored infra. */
export async function runInfrastructureValidation({ scopeType = 'all', scopeId = null, localities = null } = {}, opts = {}) {
  const filter = {}
  if (scopeType === 'locality' && scopeId) filter.locality = scopeId
  if (scopeType === 'infrastructure' && scopeId) filter.infrastructureId = scopeId
  if (localities) filter.locality = { $in: localities }

  const records = await db.collection('undergroundInfrastructure').find(filter)
  const centres = localityCentres()
  const buildings = await db.collection('buildings').find(scopeType === 'locality' && scopeId ? { locality: scopeId } : {})
  const buildingsById = new Map(buildings.map((b) => [b.buildingId, b]))
  const ctx = { localityCentres: centres, buildingsById }

  const findings = []
  for (const rec of records) findings.push(...validateRecord(rec, ctx))
  findings.push(...validateIntersections(records))

  const summary = summarize(findings, { INFRASTRUCTURE: records.length })
  const doc = {
    validationRunId: nextRunId(),
    scopeType,
    scopeId: scopeId || null,
    localities: localities || null,
    findings,
    summary,
    mlDecision: ML_DECISION_NOTE,
    disclaimer: UNDERGROUND_DISCLAIMER,
    requestedBy: opts.user?.username || null,
    createdAt: new Date().toISOString(),
    isDemo: true,
  }
  if (opts.persist !== false) await db.collection('infrastructureValidationResults').create(doc)
  return doc
}

/**
 * 2D-vs-3D intersection analysis for a set of stored infra (spec sections
 * 19-20). Returns the measured horizontal + vertical separation for every
 * crossing pair, and whether it is a true 3D collision.
 */
export async function collisionAnalysis({ locality, infrastructureIds } = {}) {
  const filter = {}
  if (locality) filter.locality = locality
  if (Array.isArray(infrastructureIds) && infrastructureIds.length) filter.infrastructureId = { $in: infrastructureIds }
  const records = await db.collection('undergroundInfrastructure').find(filter)
  const findings = validateIntersections(records)
  const pairs = findings.map((f) => ({
    a: f.entityId,
    b: f.relatedEntityId,
    ...f.geometry,
    ruleId: f.ruleId,
    status: f.status,
    message: f.message,
  }))
  return {
    locality: locality || null,
    analysed: records.length,
    pairs,
    collisions: pairs.filter((p) => p.relationship === '3D_COLLISION').length,
    twoDOnly: pairs.filter((p) => p.relationship === '2D_INTERSECTION').length,
    indeterminate: pairs.filter((p) => p.relationship === 'INDETERMINATE_Z').length,
    disclaimer: UNDERGROUND_DISCLAIMER,
  }
}

/**
 * Phase 5 elevation context for one infra record (spec section 13). Reuses the
 * validated per-building height results — it NEVER overwrites Phase 5 values
 * and NEVER treats DSM-DEM as an underground depth. Returns
 * dataAvailability: 'UNAVAILABLE' with a reason when nothing usable is nearby.
 */
export async function elevationContextForInfrastructure(rec) {
  const shape = geomShape(rec)
  if (!shape) return { dataAvailability: 'UNAVAILABLE', reason: 'Infrastructure has no usable geometry.' }
  const probe = shape.kind === 'point' ? shape.coord : shape.kind === 'line' ? shape.coords[Math.floor(shape.coords.length / 2)] : shape.ring[0]

  const buildings = await db.collection('buildings').find(rec.locality ? { locality: rec.locality } : {})
  let nearest = null
  let nearestD = Infinity
  for (const b of buildings) {
    const ring = outerRing(b.geometry)
    if (!ring) continue
    const d = pointToRingM(probe, ring)
    if (d < nearestD) { nearestD = d; nearest = b }
  }
  const NOTE = 'DSM/DEM is a SURFACE model — it is never used as an underground depth. This is context only.'
  if (!nearest || nearestD > 120) {
    return {
      dataAvailability: 'UNAVAILABLE',
      reason: 'No building with a processed elevation dataset is near this infrastructure.',
      note: NOTE,
      disclaimer: UNDERGROUND_DISCLAIMER,
    }
  }
  const [h] = await db.collection('buildingHeights').find({ buildingId: nearest.buildingId }, { sort: { timestamp: -1 }, limit: 1 })
  const surfaceElevationM = finite(rec.surfaceElevationM) ? rec.surfaceElevationM
    : (h && finite(h.groundElevationM) ? h.groundElevationM : (finite(nearest.baseElevationM) ? nearest.baseElevationM : null))
  const band = verticalBand(rec)
  return {
    dataAvailability: surfaceElevationM != null ? 'AVAILABLE' : 'PARTIAL',
    nearestBuildingId: nearest.buildingId,
    nearestBuildingDistanceM: Number(nearestD.toFixed(2)),
    surfaceElevationM,
    surfaceElevationSource: finite(rec.surfaceElevationM) ? 'INFRASTRUCTURE_RECORD'
      : (h && finite(h.groundElevationM) ? `PHASE5_ELEVATION (${h.dataSource || 'ELEVATION_DEMO'})` : 'BUILDING_BASE_ELEVATION'),
    infrastructureTopElevationM: band ? Number(band.top.toFixed(3)) : null,
    infrastructureBottomElevationM: band ? Number(band.bottom.toFixed(3)) : null,
    depthBelowSurfaceM: (surfaceElevationM != null && band) ? Number((surfaceElevationM - band.top).toFixed(3)) : (finite(rec.depthBelowSurfaceM) ? rec.depthBelowSurfaceM : null),
    verticalDatum: rec.verticalDatum || 'UNKNOWN',
    note: NOTE,
    disclaimer: UNDERGROUND_DISCLAIMER,
  }
}

export { associate, validateRecord, validateIntersections, summarize, STATUS }
