// Small point/polygon geometry helpers shared by parcel association and
// boundary verification (Phase 6). Coordinates are WGS-84 lon/lat degrees —
// distances are computed on a local tangent-plane approximation, the same
// convention as backend/src/data/geo.js (fine at neighbourhood scale).

const M_PER_DEG_LAT = 111_320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

export const outerRing = (geometry) =>
  Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0] : Array.isArray(geometry?.[0]) ? geometry : null

/** Ray-casting point-in-ring test. `pt` and `ring` are [lon,lat]. */
export function pointInRing(pt, ring) {
  const [px, py] = pt
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/** Perpendicular distance in metres from a point to a line segment (both [lon,lat]). */
function pointToSegmentM(pt, a, b, lat0) {
  const mx = mPerDegLon(lat0)
  const my = M_PER_DEG_LAT
  const px = pt[0] * mx
  const py = pt[1] * my
  const ax = a[0] * mx
  const ay = a[1] * my
  const bx = b[0] * mx
  const by = b[1] * my
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/**
 * Nearest-boundary-segment distance (metres) from a point to a polygon ring.
 * @returns {{ distanceM: number, segmentIndex: number }}
 */
export function distanceToRingM(pt, ring) {
  const lat0 = pt[1]
  let best = Infinity
  let bestIdx = -1
  for (let i = 0; i < ring.length - 1; i += 1) {
    const d = pointToSegmentM(pt, ring[i], ring[i + 1], lat0)
    if (d < best) { best = d; bestIdx = i }
  }
  return { distanceM: best, segmentIndex: bestIdx }
}

/** Simple vertex-average centroid of a ring — good enough to pick a "nearest" feature, not an area calculation. */
export function ringCentroid(ring) {
  const n = ring.length - 1
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i += 1) { sx += ring[i][0]; sy += ring[i][1] }
  return [sx / n, sy / n]
}

export function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = (lat1 - lat2) * M_PER_DEG_LAT
  const dLon = (lon1 - lon2) * mPerDegLon((lat1 + lat2) / 2)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}
