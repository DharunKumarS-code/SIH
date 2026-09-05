// Deterministic validation rules for GNSS/CORS control points (spec section
// 7). Plain rule-based checking — NOT AI, NOT a legal/survey certification.
// Each rule yields VALID | WARNING | ERROR with a `rule` slug and a
// human-readable `message`, the same convention as
// backend/src/services/geometry3d/validate.js.

import { GNSS_CONFIG } from './config.js'
import { detectHeightOutliers, detectSpatialOutliers } from './outliers.js'

export const STATUS = { VALID: 'VALID', WARNING: 'WARNING', ERROR: 'ERROR' }
const RANK = { VALID: 0, WARNING: 1, ERROR: 2 }
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a)

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

export const RULES = [
  'INVALID_LATITUDE', 'INVALID_LONGITUDE', 'MISSING_COORDINATE', 'INVALID_HEIGHT',
  'DUPLICATE_CONTROL_POINT_ID', 'DUPLICATE_COORDINATE', 'CRS_UNKNOWN', 'CRS_MISMATCH',
  'TRANSFORMATION_FAILURE', 'OUTLIER_COORDINATE', 'HEIGHT_OUTLIER', 'MISSING_TIMESTAMP',
  'INVALID_TIMESTAMP', 'ACCURACY_UNAVAILABLE', 'IMPOSSIBLE_ACCURACY', 'BOUNDARY_DEVIATION',
]

const issue = (rule, status, message, controlPointId) => ({ rule, status, message, affectedControlPoint: controlPointId ?? null })

const M_PER_DEG_LAT = 111_320
function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = (lat1 - lat2) * M_PER_DEG_LAT
  const dLon = (lon1 - lon2) * M_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

const GEOGRAPHIC_CRS_ALIASES = new Set(['EPSG:4326', 'WGS84', 'WGS 84', '4326'])
export const isGeographicCrsLabel = (crs) => {
  if (!crs) return null // unknown, not assumed
  return GEOGRAPHIC_CRS_ALIASES.has(String(crs).trim().toUpperCase())
}

/** Per-point field-level checks (rules that don't need the whole batch). */
function fieldIssues(p, id, config) {
  const issues = []
  const lat = p.latitude
  const lon = p.longitude

  const latMissing = lat === null || lat === undefined || lat === ''
  const lonMissing = lon === null || lon === undefined || lon === ''
  if (latMissing || lonMissing) {
    issues.push(issue('MISSING_COORDINATE', STATUS.ERROR, `Control point ${id}: ${latMissing ? 'latitude' : 'longitude'} is missing.`, id))
  } else {
    if (!finite(lat) || lat < config.latMin || lat > config.latMax) {
      issues.push(issue('INVALID_LATITUDE', STATUS.ERROR, `Control point ${id}: latitude ${lat} is not a valid value in [${config.latMin}, ${config.latMax}].`, id))
    }
    if (!finite(lon) || lon < config.lonMin || lon > config.lonMax) {
      issues.push(issue('INVALID_LONGITUDE', STATUS.ERROR, `Control point ${id}: longitude ${lon} is not a valid value in [${config.lonMin}, ${config.lonMax}].`, id))
    }
  }

  if (p.height !== null && p.height !== undefined && p.height !== '') {
    if (!finite(p.height) || p.height < config.heightMinM || p.height > config.heightMaxM) {
      issues.push(issue('INVALID_HEIGHT', STATUS.ERROR, `Control point ${id}: height ${p.height} is not plausible (expected [${config.heightMinM}, ${config.heightMaxM}] m).`, id))
    }
  }

  if (!p.coordinateReferenceSystem) {
    issues.push(issue('CRS_UNKNOWN', STATUS.WARNING, `Control point ${id}: no coordinateReferenceSystem supplied — treated as UNKNOWN, never assumed WGS84.`, id))
  }

  if (p.timestamp === null || p.timestamp === undefined || p.timestamp === '') {
    issues.push(issue('MISSING_TIMESTAMP', STATUS.WARNING, `Control point ${id}: no timestamp supplied.`, id))
  } else {
    const t = Date.parse(p.timestamp)
    if (Number.isNaN(t)) {
      issues.push(issue('INVALID_TIMESTAMP', STATUS.ERROR, `Control point ${id}: timestamp "${p.timestamp}" could not be parsed.`, id))
    }
  }

  const accMissing = p.accuracy === null || p.accuracy === undefined || p.accuracy === ''
  if (accMissing) {
    issues.push(issue('ACCURACY_UNAVAILABLE', STATUS.WARNING, `Control point ${id}: no accuracy supplied — accuracy is not inferred from source or survey method.`, id))
  } else if (!finite(p.accuracy) || p.accuracy < config.accuracyMinM || p.accuracy > config.accuracyMaxM) {
    issues.push(issue('IMPOSSIBLE_ACCURACY', STATUS.ERROR, `Control point ${id}: accuracy ${p.accuracy} is outside the plausible range [${config.accuracyMinM}, ${config.accuracyMaxM}] m.`, id))
  }

  return issues
}

/**
 * Validate a full batch of parsed (but not yet CRS-resolved) control points.
 * @param {object[]} points  raw parsed rows (see parse.js CORE_FIELDS)
 * @param {object} [config]
 * @returns {{ results: Array<{index,controlPointId,status,issues}>, counts, status }}
 */
export function validateBatch(points, config = GNSS_CONFIG) {
  const idOf = (p, i) => p.controlPointId || `#${i + 1}`
  const perPoint = points.map((p, i) => ({ index: i, controlPointId: idOf(p, i), issues: fieldIssues(p, idOf(p, i), config) }))

  // Rule: DUPLICATE_CONTROL_POINT_ID
  const idCounts = new Map()
  points.forEach((p, i) => {
    const id = p.controlPointId
    if (!id) return
    if (!idCounts.has(id)) idCounts.set(id, [])
    idCounts.get(id).push(i)
  })
  for (const [id, idxs] of idCounts) {
    if (idxs.length > 1) {
      for (const i of idxs) {
        perPoint[i].issues.push(issue('DUPLICATE_CONTROL_POINT_ID', STATUS.ERROR, `Control point id "${id}" is used by ${idxs.length} rows in this batch.`, id))
      }
    }
  }

  // Rule: DUPLICATE_COORDINATE (within tolerance, only among points with valid coords)
  const withCoords = points
    .map((p, i) => ({ i, lat: p.latitude, lon: p.longitude }))
    .filter((p) => finite(p.lat) && finite(p.lon))
  for (let a = 0; a < withCoords.length; a += 1) {
    for (let b = a + 1; b < withCoords.length; b += 1) {
      const d = distanceM(withCoords[a].lat, withCoords[a].lon, withCoords[b].lat, withCoords[b].lon)
      if (d <= config.duplicateCoordToleranceM) {
        const idA = perPoint[withCoords[a].i].controlPointId
        const idB = perPoint[withCoords[b].i].controlPointId
        perPoint[withCoords[a].i].issues.push(issue('DUPLICATE_COORDINATE', STATUS.WARNING, `Control point ${idA} is within ${config.duplicateCoordToleranceM} m of ${idB} — likely a duplicate observation.`, idA))
        perPoint[withCoords[b].i].issues.push(issue('DUPLICATE_COORDINATE', STATUS.WARNING, `Control point ${idB} is within ${config.duplicateCoordToleranceM} m of ${idA} — likely a duplicate observation.`, idB))
      }
    }
  }

  // Rule: OUTLIER_COORDINATE (spatial, robust MAD on nearest-neighbour distance)
  const spatialFlags = detectSpatialOutliers(points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })), config)
  spatialFlags.forEach((flag, i) => {
    if (flag) {
      perPoint[i].issues.push(issue('OUTLIER_COORDINATE', STATUS.WARNING, `Spatial outlier detected relative to neighbouring control points (${perPoint[i].controlPointId}).`, perPoint[i].controlPointId))
    }
  })

  // Rule: HEIGHT_OUTLIER
  const heightFlags = detectHeightOutliers(points.map((p) => (finite(p.height) ? p.height : null)), config)
  heightFlags.forEach((flag, i) => {
    if (flag) {
      perPoint[i].issues.push(issue('HEIGHT_OUTLIER', STATUS.WARNING, `Height is a statistical outlier relative to the batch (${perPoint[i].controlPointId}).`, perPoint[i].controlPointId))
    }
  })

  const results = perPoint.map((r) => ({
    ...r,
    status: r.issues.reduce((s, i) => worst(s, i.status), STATUS.VALID),
  }))
  const counts = { valid: 0, warning: 0, error: 0 }
  for (const r of results) counts[r.status.toLowerCase()] += 1
  const status = results.reduce((s, r) => worst(s, r.status), STATUS.VALID)
  return { results, counts, status }
}

export { worst, STATUS as GNSS_STATUS }
