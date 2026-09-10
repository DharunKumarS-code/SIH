// ---------------------------------------------------------------------------
// Spatial relationship of a TNGIS parcel polygon to the project's existing
// (DEMO) building footprints. GEOMETRY FACTS ONLY — a building sitting inside a
// parcel polygon is NOT an ownership assignment (spec section 9).
//
//   WITHIN_PARCEL             building footprint fully inside the parcel
//   CROSSES_PARCEL_BOUNDARY   building footprint straddles the parcel edge
//   NEAR_PARCEL               within `nearM` of the parcel but outside
// ---------------------------------------------------------------------------

import { outerRing, pointInRing, pointToRingM } from '../../underground/geometry.js'

/** All rings of a Polygon / MultiPolygon geometry, outer rings only. */
function polygonRings(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : []
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).map((poly) => poly[0]).filter(Boolean)
  const ring = outerRing(geometry)
  return ring ? [ring] : []
}

/** Largest ring (by |bbox area|) — the parcel's principal footprint. */
export function principalRing(geometry) {
  let best = null
  let bestArea = -1
  for (const ring of polygonRings(geometry)) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const area = (maxX - minX) * (maxY - minY)
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return best
}

/**
 * @param {object} parcelGeometry  Polygon | MultiPolygon (EPSG:4326)
 * @param {object[]} buildings     building docs ({ buildingId, ulpin, geometry })
 * @param {number} [nearM=5]
 */
export function relateBuildings(parcelGeometry, buildings = [], nearM = 5) {
  const parcelRings = polygonRings(parcelGeometry)
  if (!parcelRings.length) return []
  const out = []
  for (const b of buildings) {
    const bring = outerRing(b.geometry)
    if (!bring || bring.length < 4) continue
    let anyIn = false
    let anyOut = false
    let nearest = Infinity
    for (const v of bring) {
      const inside = parcelRings.some((r) => pointInRing(v, r))
      if (inside) anyIn = true
      else anyOut = true
      const d = Math.min(...parcelRings.map((r) => pointToRingM(v, r)))
      if (d < nearest) nearest = d
    }
    let relationship = null
    if (anyIn && anyOut) relationship = 'CROSSES_PARCEL_BOUNDARY'
    else if (anyIn) relationship = 'WITHIN_PARCEL'
    else if (nearest <= nearM) relationship = 'NEAR_PARCEL'
    if (!relationship) continue
    out.push({
      buildingId: b.buildingId,
      ulpin: b.ulpin || null,
      relationship,
      nearestBoundaryM: Number(nearest.toFixed(2)),
      note: 'Spatial relationship only — not an ownership claim.',
    })
  }
  return out.sort((a, b) => a.nearestBoundaryM - b.nearestBoundaryM)
}
