// Bounding-box prefiltering for the topology engine (Phase 7). Avoids naive
// O(n²) exact-geometry comparisons: items are sorted once by their bbox's
// minimum X, then swept left-to-right, only ever comparing an item against
// others whose X ranges could possibly overlap (or be within `radiusM` of
// each other). Only pairs that pass this cheap AABB pre-filter are worth
// sending to the expensive exact polygon check (geometryClient.js).

import { bbox } from '../../data/geo.js'

const M_PER_DEG_LAT = 111_320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/** [minX,minY,maxX,maxY] in degrees, expanded by `radiusM` (converted to degrees at this bbox's own latitude). */
export function paddedBbox(ring, radiusM = 0) {
  const [minX, minY, maxX, maxY] = bbox(ring)
  const lat = (minY + maxY) / 2
  const padLon = radiusM > 0 ? radiusM / mPerDegLon(lat) : 0
  const padLat = radiusM > 0 ? radiusM / M_PER_DEG_LAT : 0
  return [minX - padLon, minY - padLat, maxX + padLon, maxY + padLat]
}

export const bboxOverlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/**
 * Only the item PAIRS whose (radius-padded) bounding boxes overlap —
 * candidates for an expensive exact geometry check. O(n log n) sort + a
 * sweep, never a blind O(n²): items are sorted by minX once, and the inner
 * loop stops as soon as a later item's minX exceeds the current item's
 * maxX, since nothing further in sorted order can possibly overlap it.
 *
 * @param {Array<T>} items
 * @param {(item:T) => any} getRing outer ring accessor (GeoJSON Polygon or a bare ring)
 * @param {number} [radiusM] pad every bbox by this many metres before testing overlap
 * @returns {Array<[T,T]>}
 */
export function candidatePairs(items, getRing, radiusM = 0) {
  const boxed = items
    .map((item) => {
      const ring = getRing(item)
      if (!ring || ring.length < 4) return null
      return { item, box: paddedBbox(ring, radiusM) }
    })
    .filter(Boolean)
    .sort((a, b) => a.box[0] - b.box[0])

  const pairs = []
  for (let i = 0; i < boxed.length; i += 1) {
    for (let j = i + 1; j < boxed.length; j += 1) {
      if (boxed[j].box[0] > boxed[i].box[2]) break // sorted by minX — nothing further can overlap `i`
      if (bboxOverlaps(boxed[i].box, boxed[j].box)) pairs.push([boxed[i].item, boxed[j].item])
    }
  }
  return pairs
}

/**
 * Items from `others` whose (radius-padded) bbox overlaps `ring`'s — a
 * one-vs-many prefilter (e.g. one building against every parcel in a
 * locality) used before an exact containment/crossing check.
 */
export function candidatesFor(ring, others, getRing, radiusM = 0) {
  if (!ring) return []
  const box = paddedBbox(ring, radiusM)
  return others.filter((o) => {
    const r = getRing(o)
    if (!r || r.length < 4) return false
    return bboxOverlaps(box, paddedBbox(r, 0))
  })
}
