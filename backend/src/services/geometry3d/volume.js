// ---------------------------------------------------------------------------
// Prototype 3D volume model (Phase 2).
//
// A "volume" is an axis-aligned bounded box derived from an existing 2D
// footprint plus a vertical (z) range:
//
//   { volumeId, xmin, xmax, ymin, ymax, zmin, zmax,
//     geometryVersion, source, prototype, label, status }
//
// COORDINATE SYSTEM (unchanged from the rest of the app):
//   x  = WGS-84 longitude, DEGREES      (as consumed by Cesium.fromDegreesArray)
//   y  = WGS-84 latitude,  DEGREES
//   z  = metres above a local ground datum (baseHeight / topHeight)
// Horizontal metric checks convert degree deltas to metres with the same
// tangent-plane factors used in data/geo.js. See docs/14.
//
// These volume IDs (and Building/Floor/Unit IDs) are APPLICATION-LEVEL PROTOTYPE
// identifiers — never official ULPINs. The parent parcel's ULPIN provenance
// (Phase 1) is unchanged.
// ---------------------------------------------------------------------------

import { bbox, mToDegLat } from '../../data/geo.js'

// metres per degree of latitude (single source of truth: inverse of geo.js helper)
export const M_PER_DEG_LAT = 1 / mToDegLat(1)
export const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

// Geometric tolerance for containment / overlap tests, in METRES.
// The demo unit footprints are inset ~8% inside their grid cell and building
// footprints hug the parcel edge, so exact float containment always fails.
// This constant absorbs that modelling slack without masking real errors
// (a unit poking >0.5 m outside its building is still flagged).
export const GEOMETRY_TOLERANCE_M = 0.5
export const Z_TOLERANCE_M = 0.05

// Plausible storey height band (metres) for the HEIGHT_WITHIN_BOUNDS rule.
export const MIN_STOREY_M = 2.0
export const MAX_STOREY_M = 6.0

const pad2 = (n) => String(n).padStart(2, '0')
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * Deterministic PROTOTYPE volume id — stable across boots, obviously not a ULPIN.
 *   unit     → V<ff><nn>   e.g. floor 02 / apt 201 → "V0201"
 *   floor    → VF<ff>      e.g. "VF02"
 *   building → VB<bb>      e.g. "VB01"
 */
export function deriveVolumeId(kind, obj = {}) {
  const safe = (n) => (Number.isFinite(n) ? n : 0)
  if (kind === 'unit') {
    const ff = pad2(safe(obj.floorNumber))
    const nn = pad2(safe(Number(String(obj.apartmentNumber ?? '0').slice(-2))))
    return `V${ff}${nn}`
  }
  if (kind === 'floor') return `VF${pad2(safe(obj.floorNumber))}`
  if (kind === 'building') return `VB${pad2(safe(obj.buildingNumber))}`
  return `V${pad2(0)}`
}

/** Parse a prototype volume id back to its shape ("V0201" → {kind:'unit', floorNumber:2, apt:'01'}). */
export function parseVolumeId(id) {
  const s = String(id || '').toUpperCase().trim()
  let m = /^VB(\d{2})$/.exec(s)
  if (m) return { kind: 'building', buildingNumber: Number(m[1]) }
  m = /^VF(\d{2})$/.exec(s)
  if (m) return { kind: 'floor', floorNumber: Number(m[1]) }
  m = /^V(\d{2})(\d{2})$/.exec(s)
  if (m) return { kind: 'unit', floorNumber: Number(m[1]), apt: m[2] }
  return null
}

/** Outer ring of a GeoJSON Polygon (or a bare ring array). */
export const outerRing = (geometry) =>
  Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0]
    : Array.isArray(geometry?.[0]) ? geometry
      : null

/**
 * Build a volume block from a 2D footprint + a z-range.
 * `status` is left as 'UNVALIDATED' — validate.js fills it in.
 */
export function volumeFromFootprint(geometry, zmin, zmax, { volumeId, source = 'DEMO' } = {}) {
  const rng = outerRing(geometry)
  if (!rng || rng.length < 4) return null
  const [xmin, ymin, xmax, ymax] = bbox(rng)
  return {
    volumeId: volumeId || null,
    xmin, xmax, ymin, ymax,
    zmin: finite(zmin) ? zmin : null,
    zmax: finite(zmax) ? zmax : null,
    geometryVersion: 1,
    source, // mirrors the parent parcel's provenance.verificationStatus (DEMO today)
    prototype: source !== 'OFFICIAL',
    label: 'Prototype 3D Geometry',
    status: 'UNVALIDATED',
  }
}

/**
 * Axis-aligned box in LOCAL metres, measured from a shared reference origin.
 * Two boxes that are compared MUST share the same `ref` — otherwise the ~8.7e6
 * absolute magnitude near longitude 80° amplifies tiny per-box scale
 * differences into ~1 m of spurious offset.
 * @param {{lat:number, lon:number}} ref reference origin (default: the box's own centre)
 */
export function toMetreBox(v, ref) {
  if (!v || !finite(v.xmin) || !finite(v.ymin)) return null
  const origin = ref || { lat: (v.ymin + v.ymax) / 2, lon: (v.xmin + v.xmax) / 2 }
  const mLon = mPerDegLon(origin.lat)
  return {
    xmin: (v.xmin - origin.lon) * mLon, xmax: (v.xmax - origin.lon) * mLon,
    ymin: (v.ymin - origin.lat) * M_PER_DEG_LAT, ymax: (v.ymax - origin.lat) * M_PER_DEG_LAT,
    zmin: v.zmin, zmax: v.zmax,
  }
}

/** Reference origin (centre) of a volume's horizontal bounds. */
export const volumeRef = (v) =>
  v && finite(v.xmin) ? { lat: (v.ymin + v.ymax) / 2, lon: (v.xmin + v.xmax) / 2 } : null

/** Is metric box `inner` within `outer`, allowing `tolM` of slop? */
export function boxContains(outer, inner, tolM = GEOMETRY_TOLERANCE_M) {
  if (!outer || !inner) return { inside: false, maxOutM: Infinity }
  const outM = Math.max(
    outer.xmin - inner.xmin,
    inner.xmax - outer.xmax,
    outer.ymin - inner.ymin,
    inner.ymax - outer.ymax,
    0,
  )
  return { inside: outM <= tolM, maxOutM: outM }
}

/** Horizontal overlap area (m²) of two metric boxes. */
export function boxOverlapM2(a, b) {
  if (!a || !b) return 0
  const w = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin))
  const d = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin))
  return w * d
}

/**
 * Derived metrics for display. width/depth/footprint/volume are only meaningful
 * for a roughly-rectangular bbox; callers show "Not available" when null.
 */
export function volumeMetrics(v) {
  if (!v) return null
  const heightM = finite(v.zmin) && finite(v.zmax) ? Number((v.zmax - v.zmin).toFixed(2)) : null
  const box = toMetreBox(v)
  const widthM = box ? Number((box.xmax - box.xmin).toFixed(2)) : null
  const depthM = box ? Number((box.ymax - box.ymin).toFixed(2)) : null
  const footprintM2 = widthM != null && depthM != null ? Number((widthM * depthM).toFixed(1)) : null
  const volumeM3 = footprintM2 != null && heightM != null ? Number((footprintM2 * heightM).toFixed(1)) : null
  return { heightM, widthM, depthM, footprintM2, volumeM3 }
}
