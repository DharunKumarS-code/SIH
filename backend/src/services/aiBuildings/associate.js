// Spatial association of an AI-extracted building polygon with the existing
// demo parcels of a locality.
//
// The demo parcels are axis-aligned rectangles (geo.js `rectRing`), so the
// building polygon is clipped to each parcel's bounding rectangle
// (Sutherland–Hodgman) to get an EXACT intersection area. Association rule:
//
//   MATCHED          centroid inside one parcel AND overlap >= 70% of the
//                    building area
//   MULTI_PARCEL     >= 2 parcels each covering >= 15% of the building area
//                    (candidates exposed; NEVER an arbitrary single pick)
//   REVIEW_REQUIRED  centroid inside a parcel but overlap < 70%
//   OUTSIDE_PARCEL   no parcel contains the centroid and no meaningful overlap
//
// Coordinates are WGS-84 lon/lat degrees (the app's CRS). Areas are computed
// on the local tangent plane via geo.js `ringAreaM2`.

import { bbox, ringAreaM2 } from '../../data/geo.js'

const MATCH_MIN = 0.70
const MULTI_MIN = 0.15

const outerRing = (geometry) =>
  Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0] : Array.isArray(geometry?.[0]) ? geometry : null

function centroid(ring) {
  let x = 0
  let y = 0
  let a = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    const cross = x1 * y2 - x2 * y1
    a += cross
    x += (x1 + x2) * cross
    y += (y1 + y2) * cross
  }
  if (Math.abs(a) < 1e-14) {
    // degenerate — fall back to the vertex average
    const n = ring.length - 1
    return [ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n, ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n]
  }
  a *= 3
  return [x / a, y / a]
}

// ray-casting point-in-ring
function pointInRing(pt, ring) {
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

// clip a polygon ring to an axis-aligned rectangle [minX,minY,maxX,maxY]
function clipToRect(ring, [minX, minY, maxX, maxY]) {
  const edges = [
    (p) => p[0] >= minX, // left
    (p) => p[0] <= maxX, // right
    (p) => p[1] >= minY, // bottom
    (p) => p[1] <= maxY, // top
  ]
  const isect = [
    (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])],
    (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY],
    (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY],
  ]
  let poly = ring.slice(0, -1) // open ring
  for (let e = 0; e < 4; e += 1) {
    if (poly.length === 0) break
    const inside = edges[e]
    const cut = isect[e]
    const next = []
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i]
      const prev = poly[(i + poly.length - 1) % poly.length]
      const curIn = inside(cur)
      const prevIn = inside(prev)
      if (curIn) {
        if (!prevIn) next.push(cut(prev, cur))
        next.push(cur)
      } else if (prevIn) {
        next.push(cut(prev, cur))
      }
    }
    poly = next
  }
  if (poly.length < 3) return null
  return [...poly, poly[0]]
}

/**
 * @param {number[][]} ring   closed lon/lat ring of the AI building
 * @param {object[]} parcels  parcel docs for the locality (each with .geometry, .ulpin, .parcelId)
 * @returns {{ parcelStatus, parentParcelId, parentULPIN, parcelCandidates }}
 */
export function associateParcel(ring, parcels) {
  if (!Array.isArray(ring) || ring.length < 4) {
    return { parcelStatus: 'REVIEW_REQUIRED', parentParcelId: null, parentULPIN: null, parcelCandidates: [] }
  }
  const lat = ring[0][1]
  const buildingArea = ringAreaM2(ring, lat) || 1e-6
  const c = centroid(ring)

  const hits = []
  for (const p of parcels) {
    const pr = outerRing(p.geometry)
    if (!pr || pr.length < 4) continue
    const rect = bbox(pr)
    const clipped = clipToRect(ring, rect)
    const overlapArea = clipped ? ringAreaM2(clipped, lat) : 0
    const overlapRatio = overlapArea / buildingArea
    const centroidIn = pointInRing(c, pr)
    if (overlapRatio > 0.001 || centroidIn) {
      hits.push({ parcelId: p.parcelId, ulpin: p.ulpin, overlapRatio: Number(overlapRatio.toFixed(3)), centroidIn })
    }
  }
  hits.sort((a, b) => b.overlapRatio - a.overlapRatio)

  const candidates = hits.map((h) => ({ parcelId: h.parcelId, ulpin: h.ulpin, overlapRatio: h.overlapRatio }))
  const strong = hits.filter((h) => h.overlapRatio >= MULTI_MIN)

  if (strong.length >= 2) {
    return { parcelStatus: 'MULTI_PARCEL', parentParcelId: null, parentULPIN: null, parcelCandidates: candidates }
  }
  const best = hits[0]
  if (best && best.centroidIn && best.overlapRatio >= MATCH_MIN) {
    return { parcelStatus: 'MATCHED', parentParcelId: best.parcelId, parentULPIN: best.ulpin || null, parcelCandidates: candidates }
  }
  if (best && (best.centroidIn || best.overlapRatio > 0.05)) {
    return { parcelStatus: 'REVIEW_REQUIRED', parentParcelId: best.parcelId, parentULPIN: null, parcelCandidates: candidates }
  }
  return { parcelStatus: 'OUTSIDE_PARCEL', parentParcelId: null, parentULPIN: null, parcelCandidates: candidates }
}
