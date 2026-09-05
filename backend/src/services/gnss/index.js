// GNSS/CORS high-precision spatial control orchestrator (Phase 6, additive).
//
//   raw CSV/JSON/GeoJSON  ->  parse (parse.js)
//                          ->  field + batch validation (validate.js)
//                          ->  CRS resolution (WGS84 pass-through, or pyproj
//                              transform via the ai-service for a projected CRS)
//                          ->  parcel association (associate.js)
//                          ->  boundary verification (boundary.js)
//                          ->  gnssControlPoints docs -> Mongo
//
// Every stored point carries explicit, non-fabricated provenance and
// accuracy handling (spec sections 3 and 9): accuracy is NEVER inferred from
// source/surveyMethod, only ever the number actually supplied.

import { db } from '../../store/index.js'
import { DEFAULT_LOCALITY_ID, getLocality } from '../../data/localities.js'
import { CORE_FIELDS, ParseError, parseControlPoints } from './parse.js'
import { STATUS, isGeographicCrsLabel, validateBatch, worst } from './validate.js'
import { transformPoints, gnssConfig as fetchGnssConfig } from './crsClient.js'
import { associateParcel } from './associate.js'
import { computeElevationResidual } from './elevation.js'
import { distanceM, outerRing, ringCentroid } from './geomUtils.js'
import { GNSS_CONFIG, GNSS_DISCLAIMER, normaliseSource, SURVEY_SOURCES } from './config.js'

export class UploadValidationError extends Error {}

export { GNSS_DISCLAIMER as AI_GNSS_DISCLAIMER }

export function validateUpload(file, { maxMb = 5 } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadValidationError('No file provided.')
  const mb = file.buffer.length / (1024 * 1024)
  if (mb > maxMb) throw new UploadValidationError(`File too large (${mb.toFixed(1)} MB > ${maxMb} MB limit).`)
  return { name: file.originalname || 'upload', sizeBytes: file.buffer.length }
}

let seq = Date.now() % 100000
const nextControlPointId = () => {
  seq += 1
  return `GNSS-CHN-${String(seq).padStart(6, '0')}`
}
const jobId = () => `GNSSJOB-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`

/**
 * Resolve every point's usable WGS84 latitude/longitude.
 *  - No CRS or an explicit geographic CRS (WGS84/EPSG:4326): used as-is.
 *  - A projected CRS: `latitude`/`longitude` are treated as the dataset's own
 *    northing/easting pair and transformed via pyproj (ai-service). Never a
 *    silent/guessed transform — unavailable service -> TRANSFORMATION_UNAVAILABLE.
 */
async function resolveCrs(points, targetCrs = 'EPSG:4326') {
  const crsStatusByIndex = new Array(points.length).fill('UNKNOWN')
  const resolved = points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
  const extraIssues = points.map(() => [])

  const projectedIdx = []
  points.forEach((p, i) => {
    const geo = isGeographicCrsLabel(p.coordinateReferenceSystem)
    if (geo === true) crsStatusByIndex[i] = 'MATCHED'
    else if (geo === null) crsStatusByIndex[i] = 'UNKNOWN' // missing or unparsable label — never guessed
    else projectedIdx.push(i) // geo === false -> a declared projected CRS
  })

  // Group by declared CRS label so each distinct projected CRS is transformed once.
  const byCrs = new Map()
  for (const i of projectedIdx) {
    const crs = points[i].coordinateReferenceSystem
    if (!byCrs.has(crs)) byCrs.set(crs, [])
    byCrs.get(crs).push(i)
  }

  for (const [crs, idxs] of byCrs) {
    const valid = idxs.filter((i) => Number.isFinite(points[i].longitude) && Number.isFinite(points[i].latitude))
    if (!valid.length) continue
    const batch = valid.map((i) => ({ x: points[i].longitude, y: points[i].latitude }))
    const result = await transformPoints(batch, crs, targetCrs)
    valid.forEach((i, k) => {
      if (result.status === 'REPROJECTED' && result.points?.[k]?.transformStatus === 'OK') {
        crsStatusByIndex[i] = 'REPROJECTED'
        resolved[i] = { longitude: result.points[k].x, latitude: result.points[k].y }
      } else if (result.status === 'MATCHED') {
        crsStatusByIndex[i] = 'MATCHED'
      } else {
        crsStatusByIndex[i] = result.status === 'UNKNOWN' ? 'UNKNOWN' : 'TRANSFORMATION_UNAVAILABLE'
        resolved[i] = { latitude: null, longitude: null }
        extraIssues[i].push({
          rule: 'TRANSFORMATION_FAILURE',
          status: STATUS.ERROR,
          message: `Control point ${points[i].controlPointId || `#${i + 1}`}: CRS transform (${crs} -> ${targetCrs}) failed or is unavailable — ${result.note || 'no coordinate was fabricated.'}`,
          affectedControlPoint: points[i].controlPointId || null,
        })
      }
    })
  }

  return { crsStatusByIndex, resolved, extraIssues }
}

async function resolveFootprintsAndParcels(locality) {
  const loc = getLocality(locality || DEFAULT_LOCALITY_ID)
  const parcels = await db.collection('parcels').find({ locality: loc.id })
  return { loc, parcels }
}

/** GET /gnss/config passthrough merged with local (Node-side) thresholds. */
export async function gnssPipelineConfig() {
  const py = await fetchGnssConfig()
  return {
    pipeline: [
      'File input (CSV / JSON / GeoJSON)', 'Field + batch validation', 'CRS resolution / transformation',
      'Outlier detection', 'Parcel association', 'Boundary verification', 'DEM/DSM elevation residual (optional)',
      'Storage (gnssControlPoints)',
    ],
    thresholds: GNSS_CONFIG,
    transform: py, // null if the ai-service is unreachable — never fabricated
    disclaimer: GNSS_DISCLAIMER,
    coreFields: CORE_FIELDS,
  }
}

/**
 * Parse + validate a batch WITHOUT persisting anything (preview / dry-run).
 */
export async function validateControlPoints({ text, format, fieldMap, locality }) {
  let raw
  try {
    raw = parseControlPoints(text, format, fieldMap)
  } catch (e) {
    if (e instanceof ParseError) throw new UploadValidationError(e.message)
    throw e
  }
  if (!raw.length) throw new UploadValidationError('No control points found in the uploaded file.')

  const batch = validateBatch(raw)
  const { crsStatusByIndex, resolved, extraIssues } = await resolveCrs(raw)

  const { parcels } = await resolveFootprintsAndParcels(locality)

  const points = raw.map((p, i) => {
    const issues = [...batch.results[i].issues, ...extraIssues[i]]
    const resolvedPoint = resolved[i]
    let association = null
    if (Number.isFinite(resolvedPoint.latitude) && Number.isFinite(resolvedPoint.longitude)) {
      association = associateParcel(resolvedPoint, parcels)
    }
    const status = issues.reduce((s, iss) => worst(s, iss.status), STATUS.VALID)
    return {
      index: i,
      controlPointId: batch.results[i].controlPointId,
      input: p,
      resolvedLatitude: resolvedPoint.latitude,
      resolvedLongitude: resolvedPoint.longitude,
      crsStatus: crsStatusByIndex[i],
      validationStatus: status,
      issues,
      parcelAssociation: association,
    }
  })

  const counts = { valid: 0, warning: 0, error: 0 }
  for (const p of points) counts[p.validationStatus.toLowerCase()] += 1

  return {
    points,
    counts,
    overallStatus: counts.error > 0 ? 'ERROR' : counts.warning > 0 ? 'WARNING' : 'VALID',
    disclaimer: GNSS_DISCLAIMER,
  }
}

/**
 * Parse, validate, resolve CRS, associate with parcels and PERSIST every
 * control point + a job summary. Never overwrites parcel geometry.
 */
export async function importControlPoints({ text, format, fieldMap, locality, sourceLabel, provenanceNote, user }) {
  const preview = await validateControlPoints({ text, format, fieldMap, locality })
  const loc = getLocality(locality || DEFAULT_LOCALITY_ID)
  const jid = jobId()
  const now = new Date().toISOString()
  // The per-point `source` column (spec section 2, core contract) always
  // wins; `sourceLabel` is only a batch-level default for rows that didn't
  // supply their own — never an override of an explicit per-point value.
  const batchDefaultSource = normaliseSource(sourceLabel)

  await db.collection('aiJobs').create({
    jobId: jid, kind: 'gnss', status: 'PROCESSING', locality: loc.id,
    pointCount: preview.points.length, requestedBy: user?.username || null, createdAt: now,
    source: batchDefaultSource, disclaimer: GNSS_DISCLAIMER,
  })

  const stored = []
  for (const p of preview.points) {
    const raw = p.input
    const accuracySupplied = Number.isFinite(raw.accuracy)
    const source = raw.source ? normaliseSource(raw.source) : batchDefaultSource
    const isSurveyGrade = SURVEY_SOURCES.has(source)
    const doc = {
      controlPointId: raw.controlPointId || nextControlPointId(),
      latitude: raw.latitude ?? null,
      longitude: raw.longitude ?? null,
      resolvedLatitude: p.resolvedLatitude,
      resolvedLongitude: p.resolvedLongitude,
      height: Number.isFinite(raw.height) ? raw.height : null,
      // Accuracy is stored EXACTLY as supplied, or explicitly null — never
      // inferred from source/surveyMethod (spec section 3/9, CRITICAL).
      accuracy: accuracySupplied ? raw.accuracy : null,
      accuracyStatus: accuracySupplied ? 'REPORTED' : (source === 'DEMO' || source === 'TEST_FIXTURE' ? 'NOT_SURVEY_VALIDATED' : 'UNAVAILABLE'),
      coordinateReferenceSystem: raw.coordinateReferenceSystem || null,
      crsStatus: p.crsStatus,
      timestamp: raw.timestamp || null,
      source,
      isSurveyGradeSource: isSurveyGrade, // naming alone — NOT proof of accuracy
      surveyMethod: raw.surveyMethod || null,
      // ---- optional metadata (never required, never fabricated) ----
      horizontalAccuracy: raw.horizontalAccuracy ?? null,
      verticalAccuracy: raw.verticalAccuracy ?? null,
      accuracyUnit: raw.accuracyUnit || (accuracySupplied ? 'm' : null),
      horizontalDatum: raw.horizontalDatum || null,
      verticalDatum: raw.verticalDatum || null,
      epoch: raw.epoch || null,
      antennaHeight: raw.antennaHeight ?? null,
      observationDuration: raw.observationDuration ?? null,
      fixStatus: raw.fixStatus || null,
      satelliteCount: raw.satelliteCount ?? null,
      pdop: raw.pdop ?? null,
      correctionSource: raw.correctionSource || null,
      referenceStation: raw.referenceStation || null,
      operator: raw.operator || null,
      surveySessionId: raw.surveySessionId || null,
      provenanceNote: provenanceNote || null,
      verificationStatus: raw.verificationStatus || 'UNVERIFIED',
      // ---- validation ----
      validationStatus: p.validationStatus,
      validationIssues: p.issues,
      // ---- parcel association ----
      parcelStatus: p.parcelAssociation?.parcelStatus || 'OUTSIDE_PARCEL',
      parentParcelId: p.parcelAssociation?.parentParcelId || null,
      parentULPIN: p.parcelAssociation?.parentULPIN || null,
      associationConfidence: p.parcelAssociation?.associationConfidence ?? null,
      parcelCandidates: p.parcelAssociation?.parcelCandidates || [],
      nearestBoundaryM: p.parcelAssociation?.nearestBoundaryM ?? null,
      // ---- bookkeeping ----
      jobId: jid,
      locality: loc.id,
      isOfficial: false,
      isDemo: true,
      disclaimer: GNSS_DISCLAIMER,
      createdBy: user?.username || null,
      createdAt: now,
    }
    await db.collection('gnssControlPoints').create(doc)
    stored.push(doc)
  }

  const summary = {
    total: stored.length,
    valid: stored.filter((d) => d.validationStatus === 'VALID').length,
    warning: stored.filter((d) => d.validationStatus === 'WARNING').length,
    error: stored.filter((d) => d.validationStatus === 'ERROR').length,
    matched: stored.filter((d) => d.parcelStatus === 'MATCHED').length,
    multiParcel: stored.filter((d) => d.parcelStatus === 'MULTI_PARCEL').length,
    outsideParcel: stored.filter((d) => d.parcelStatus === 'OUTSIDE_PARCEL').length,
    reviewRequired: stored.filter((d) => d.parcelStatus === 'REVIEW_REQUIRED').length,
  }

  await db.collection('aiJobs').updateOne({ jobId: jid }, { status: 'COMPLETED', completedAt: new Date().toISOString(), summary })

  return { jobId: jid, status: 'COMPLETED', locality: loc.id, controlPoints: stored, summary, disclaimer: GNSS_DISCLAIMER }
}

/** Geometrically nearest building to a point — association is parcel-level only, so this is a documented heuristic, not an authoritative building match. */
function nearestBuilding(point, buildings) {
  let best = null
  let bestD = Infinity
  for (const b of buildings) {
    const ring = outerRing(b.geometry)
    if (!ring || ring.length < 4) continue
    const [clon, clat] = ringCentroid(ring)
    const d = distanceM(point.resolvedLatitude ?? point.latitude, point.resolvedLongitude ?? point.longitude, clat, clon)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

export async function elevationResidualForControlPoint(controlPoint) {
  let building = null
  let latestHeight = null
  if (controlPoint.parentParcelId && controlPoint.parentULPIN) {
    const buildings = await db.collection('buildings').find({ ulpin: controlPoint.parentULPIN })
    building = nearestBuilding(controlPoint, buildings)
    if (building) {
      const rows = await db.collection('buildingHeights').find({ buildingId: building.buildingId }, { sort: { timestamp: -1 }, limit: 1 })
      latestHeight = rows[0] || null
    }
  }
  return computeElevationResidual(controlPoint, building, latestHeight)
}
