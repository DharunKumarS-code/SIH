// Deterministic outlier detection for a batch of GNSS/CORS control points
// (spec section 8). Robust statistics only — median + median absolute
// deviation (MAD), never a normal-distribution assumption, which would be
// distorted by the very outliers being sought.
//
// IMPORTANT: this can only ever report "this point differs from its
// neighbours by more than expected" — it never claims a specific real-world
// measurement error unless the dataset's own supplied accuracy independently
// supports that (see validate.js ACCURACY_UNAVAILABLE / IMPOSSIBLE_ACCURACY).

import { GNSS_CONFIG } from './config.js'

const M_PER_DEG_LAT = 111_320

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (!n) return null
  const mid = Math.floor(n / 2)
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median Absolute Deviation, scaled so it estimates a normal std-dev (for comparability only). */
function mad(values, med) {
  const deviations = values.map((v) => Math.abs(v - med))
  return median(deviations)
}

/** Robust modified z-scores (Iglewicz & Hoaglin). */
function robustZScores(values) {
  const med = median(values)
  if (med === null) return []
  const m = mad(values, med)
  if (!m || m === 0) return values.map(() => 0)
  return values.map((v) => (0.6745 * (v - med)) / m)
}

function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = (lat1 - lat2) * M_PER_DEG_LAT
  const dLon = (lon1 - lon2) * M_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

/**
 * @param {Array<{latitude:number, longitude:number}>} points  points with resolved WGS84 lat/lon (nulls skipped)
 * @returns {number[]} per-point nearest-neighbour distance in metres, or null where undeterminable
 */
export function nearestNeighbourDistances(points) {
  const valid = points
    .map((p, i) => ({ i, lat: p?.latitude, lon: p?.longitude }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  const out = new Array(points.length).fill(null)
  if (valid.length < 2) return out
  for (const a of valid) {
    let best = Infinity
    for (const b of valid) {
      if (a.i === b.i) continue
      const d = distanceM(a.lat, a.lon, b.lat, b.lon)
      if (d < best) best = d
    }
    out[a.i] = best
  }
  return out
}

/**
 * Detect spatial outliers: a point whose nearest-neighbour distance is a
 * robust statistical outlier relative to the batch (documented method:
 * MAD on nearest-neighbour distance — spec section 8's "local neighbor
 * distance" option).
 * @returns {boolean[]} per-point outlier flag (false where undeterminable)
 */
export function detectSpatialOutliers(points, config = GNSS_CONFIG) {
  if (points.length < config.minPointsForOutlierDetection) return points.map(() => false)
  const dists = nearestNeighbourDistances(points)
  const finiteIdx = dists.map((d, i) => (d != null ? i : -1)).filter((i) => i >= 0)
  if (finiteIdx.length < config.minPointsForOutlierDetection) return points.map(() => false)
  const values = finiteIdx.map((i) => dists[i])
  const z = robustZScores(values)
  const flags = points.map(() => false)
  finiteIdx.forEach((idx, k) => {
    // Only the "far from everything" direction is an anomaly here (a large
    // positive z on distance) — being unusually CLOSE to a neighbour is not.
    if (z[k] > config.outlierMadK) flags[idx] = true
  })
  return flags
}

/**
 * Detect height outliers via MAD on the supplied height values.
 * @param {Array<number|null>} heights
 * @returns {boolean[]}
 */
export function detectHeightOutliers(heights, config = GNSS_CONFIG) {
  const finiteIdx = heights.map((h, i) => (Number.isFinite(h) ? i : -1)).filter((i) => i >= 0)
  if (finiteIdx.length < config.minPointsForOutlierDetection) return heights.map(() => false)
  const values = finiteIdx.map((i) => heights[i])
  const z = robustZScores(values)
  const flags = heights.map(() => false)
  finiteIdx.forEach((idx, k) => {
    if (Math.abs(z[k]) > config.outlierMadK) flags[idx] = true
  })
  return flags
}

export const _internal = { median, mad, robustZScores, distanceM }
