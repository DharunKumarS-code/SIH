// Phase 8 — true 3D geometry helpers for underground infrastructure.
//
// DETERMINISTIC computational geometry only — never "AI". Coordinates are
// WGS-84 lon/lat degrees for X/Y and metres for Z, the SAME convention as the
// Phase-2 volume model (see services/geometry3d/volume.js) — Phase 8 does NOT
// introduce a second coordinate system.
//
// Horizontal distances use a local tangent-plane approximation (data/geo.js /
// gnss/geomUtils.js convention), which is accurate at neighbourhood scale.
//
// KEY PHASE-8 RULE (spec section 19): a 2D intersection is NOT automatically a
// 3D collision. `intersection3D()` distinguishes 2D_INTERSECTION from
// 3D_COLLISION using each asset's vertical [bottom, top] band.

const M_PER_DEG_LAT = 111_320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

export const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/** Outer ring of a GeoJSON Polygon (or a bare ring array). */
export const outerRing = (geometry) =>
  Array.isArray(geometry?.coordinates?.[0]?.[0]) ? geometry.coordinates[0]
    : Array.isArray(geometry?.[0]) ? geometry
      : null

/** LineString coordinate list (or a bare array of [lon,lat] pairs). */
export const lineCoords = (geometry) =>
  geometry?.type === 'LineString' && Array.isArray(geometry.coordinates) ? geometry.coordinates
    : Array.isArray(geometry) && Array.isArray(geometry[0]) ? geometry
      : null

export const pointCoords = (geometry) =>
  geometry?.type === 'Point' && Array.isArray(geometry.coordinates) ? geometry.coordinates : null

/** Great-ish-circle metres between two [lon,lat] points (tangent-plane). */
export function distM([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat1 - lat2) * M_PER_DEG_LAT
  const dLon = (lon1 - lon2) * mPerDegLon((lat1 + lat2) / 2)
  return Math.hypot(dLat, dLon)
}

/** Total length (metres) of a polyline given as [[lon,lat],...]. */
export function polylineLengthM(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) total += distM(coords[i - 1], coords[i])
  return total
}

/** Bounding box [minLon,minLat,maxLon,maxLat] of any coordinate list/ring. */
export function bboxOf(coords) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of coords) {
    const [x, y] = c
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

export const bboxOverlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** Do 2D segments p1-p2 and p3-p4 (each [lon,lat]) properly intersect or touch? */
export function segmentsIntersect2D(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const onSeg = (a, b, c) =>
    Math.min(a[0], b[0]) - 1e-12 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    Math.min(a[1], b[1]) - 1e-12 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-12
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  if (Math.abs(d1) < 1e-15 && onSeg(p3, p4, p1)) return true
  if (Math.abs(d2) < 1e-15 && onSeg(p3, p4, p2)) return true
  if (Math.abs(d3) < 1e-15 && onSeg(p1, p2, p3)) return true
  if (Math.abs(d4) < 1e-15 && onSeg(p1, p2, p4)) return true
  return false
}

/** Does a polyline self-intersect (any non-adjacent segment pair crosses)? */
export function polylineSelfIntersects(coords) {
  const n = coords.length - 1
  if (n < 3) return false
  const closed = distM(coords[0], coords[n]) < 1e-9
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      // Only skip the first/last segment pair when the ring is actually closed
      // (they legitimately share the closing vertex). For an OPEN polyline the
      // first and last segments touching IS a self-intersection.
      if (closed && i === 0 && j === n - 1) continue
      if (segmentsIntersect2D(coords[i], coords[i + 1], coords[j], coords[j + 1])) return true
    }
  }
  return false
}

/** Ray-casting point-in-ring ([lon,lat]). */
export function pointInRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/** Perpendicular distance (metres) from a point to a segment (all [lon,lat]). */
export function pointToSegmentM(pt, a, b) {
  const lat0 = pt[1]
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
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Minimum distance (metres) from a point to a polyline. */
export function pointToPolylineM(pt, coords) {
  let best = Infinity
  for (let i = 1; i < coords.length; i += 1) {
    const d = pointToSegmentM(pt, coords[i - 1], coords[i])
    if (d < best) best = d
  }
  return best
}

/** Minimum distance (metres) between two polylines (0 if they cross in 2D). */
export function polylineToPolylineM(a, b) {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsIntersect2D(a[i - 1], a[i], b[j - 1], b[j])) return 0
    }
  }
  let best = Infinity
  for (const p of a) best = Math.min(best, pointToPolylineM(p, b))
  for (const p of b) best = Math.min(best, pointToPolylineM(p, a))
  return best
}

/** Nearest-boundary distance (metres) from a point to a polygon ring. */
export function pointToRingM(pt, ring) {
  let best = Infinity
  for (let i = 1; i < ring.length; i += 1) {
    const d = pointToSegmentM(pt, ring[i - 1], ring[i])
    if (d < best) best = d
  }
  return best
}

// ---------------------------------------------------------------------------
// Vertical band of an infrastructure record.
//
// Prefers explicit absolute elevations (top/bottom); falls back to a
// surface elevation minus a depth-below-surface; returns null when the
// source supplied nothing usable — NEVER a guessed value (spec section 9).
// ---------------------------------------------------------------------------
export function verticalBand(rec) {
  const top = finite(rec.topElevationM) ? rec.topElevationM : null
  const bottom = finite(rec.bottomElevationM) ? rec.bottomElevationM : null
  if (top != null && bottom != null) {
    return { top: Math.max(top, bottom), bottom: Math.min(top, bottom), basis: 'ABSOLUTE_ELEVATION' }
  }
  const surface = finite(rec.surfaceElevationM) ? rec.surfaceElevationM : null
  const depth = finite(rec.depthBelowSurfaceM) ? rec.depthBelowSurfaceM : null
  const thickness = finite(rec.diameterM) ? rec.diameterM
    : finite(rec.heightM) ? rec.heightM
      : 0
  if (surface != null && depth != null) {
    const crown = surface - depth
    return { top: crown, bottom: crown - thickness, basis: 'SURFACE_MINUS_DEPTH' }
  }
  if (top != null) return { top, bottom: top - thickness, basis: 'TOP_ELEVATION_ONLY' }
  if (bottom != null) return { top: bottom + thickness, bottom, basis: 'BOTTOM_ELEVATION_ONLY' }
  return null // no reliable Z — caller must treat depth/elevation as UNKNOWN
}

/** Overlap of two 1-D intervals, or negative gap (separation) when disjoint. */
function intervalOverlap(aLo, aHi, bLo, bHi) {
  return Math.min(aHi, bHi) - Math.max(aLo, bLo)
}

// ---------------------------------------------------------------------------
// 3D intersection / vertical-separation analysis for a pair of assets
// (spec sections 19-20). This is the heart of Phase 8.
//
//   - `horizontal2D`   : 'INTERSECT' | 'SEPARATE'  (+ measured horizontalSeparationM)
//   - `verticalStatus` : 'BOTH_KNOWN' | 'Z_UNKNOWN'
//   - `verticalSeparationM` : gap between the two vertical bands (null if unknown)
//   - `relationship`   : '3D_COLLISION' | '2D_INTERSECTION' | 'NO_INTERSECTION' | 'INDETERMINATE_Z'
//   - `clearanceStatus`: 'REVIEW_REQUIRED' unless an authoritative rule is configured
//
// We NEVER report a 3D collision when only the 2D projections intersect and the
// vertical bands are clear of each other.
// ---------------------------------------------------------------------------
export function intersection3D(recA, geomA, recB, geomB, config) {
  const cfg = config || {}
  const a2d = geomA
  const b2d = geomB

  // ---- horizontal relationship ----
  let horizontalSeparationM = null
  if (a2d.kind === 'line' && b2d.kind === 'line') {
    horizontalSeparationM = polylineToPolylineM(a2d.coords, b2d.coords)
  } else if (a2d.kind === 'point' && b2d.kind === 'line') {
    horizontalSeparationM = pointToPolylineM(a2d.coord, b2d.coords)
  } else if (a2d.kind === 'line' && b2d.kind === 'point') {
    horizontalSeparationM = pointToPolylineM(b2d.coord, a2d.coords)
  } else if (a2d.kind === 'point' && b2d.kind === 'point') {
    horizontalSeparationM = distM(a2d.coord, b2d.coord)
  } else if (a2d.kind === 'ring' || b2d.kind === 'ring') {
    // Treat a ring as its boundary polyline for separation, plus a
    // containment test for the "inside" case.
    const ringGeom = a2d.kind === 'ring' ? a2d : b2d
    const other = a2d.kind === 'ring' ? b2d : a2d
    const probe = other.kind === 'point' ? [other.coord] : other.coords
    const anyInside = probe.some((p) => pointInRing(p, ringGeom.ring))
    horizontalSeparationM = anyInside ? 0 : Math.min(...probe.map((p) => pointToRingM(p, ringGeom.ring)))
  }
  const horizontal2D = horizontalSeparationM != null && horizontalSeparationM <= 0.0 + 1e-9
    ? 'INTERSECT'
    : 'SEPARATE'

  // ---- vertical relationship ----
  const bandA = verticalBand(recA)
  const bandB = verticalBand(recB)
  const zKnown = bandA != null && bandB != null

  let verticalSeparationM = null
  let verticalOverlap = null
  if (zKnown) {
    const ov = intervalOverlap(bandA.bottom, bandA.top, bandB.bottom, bandB.top)
    verticalOverlap = ov
    verticalSeparationM = ov >= 0 ? 0 : Number(Math.abs(ov).toFixed(3))
  }

  // ---- combine ----
  let relationship
  if (horizontal2D === 'SEPARATE') {
    relationship = 'NO_INTERSECTION'
  } else if (!zKnown) {
    relationship = 'INDETERMINATE_Z' // 2D projections cross but at least one asset has no reliable Z
  } else if (verticalOverlap > (cfg.collisionVerticalToleranceM ?? 0)) {
    relationship = '3D_COLLISION'
  } else {
    relationship = '2D_INTERSECTION' // cross in plan, but vertically clear — NOT a collision
  }

  // ---- clearance verdict (spec section 20): never invent a threshold ----
  let clearanceStatus = 'NOT_APPLICABLE'
  if (relationship === '2D_INTERSECTION' || relationship === '3D_COLLISION') {
    if (finite(cfg.authoritativeClearanceM)) {
      clearanceStatus = relationship === '3D_COLLISION' || verticalSeparationM < cfg.authoritativeClearanceM
        ? 'BELOW_AUTHORITATIVE_CLEARANCE'
        : 'MEETS_AUTHORITATIVE_CLEARANCE'
    } else {
      clearanceStatus = 'REVIEW_REQUIRED'
    }
  }

  return {
    horizontal2D,
    horizontalSeparationM: horizontalSeparationM != null ? Number(horizontalSeparationM.toFixed(3)) : null,
    verticalStatus: zKnown ? 'BOTH_KNOWN' : 'Z_UNKNOWN',
    verticalBandA: bandA,
    verticalBandB: bandB,
    verticalSeparationM,
    relationship,
    clearanceStatus,
  }
}

/** Normalise a stored infra record's geometry into a compact {kind, coords|coord|ring, bbox}. */
export function geomShape(rec) {
  const g = rec.geometry
  const line = lineCoords(g)
  if (line && line.length >= 2) return { kind: 'line', coords: line, bbox: bboxOf(line) }
  const pt = pointCoords(g)
  if (pt && pt.length >= 2) return { kind: 'point', coord: pt, bbox: [pt[0], pt[1], pt[0], pt[1]] }
  const ring = outerRing(g)
  if (ring && ring.length >= 4) return { kind: 'ring', ring, bbox: bboxOf(ring) }
  return null
}
