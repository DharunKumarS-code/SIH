// ---------------------------------------------------------------------------
// Underground Infrastructure 3D Explorer — pure, framework-free helpers.
//
// No THREE / React import here on purpose: this module stays unit-testable in
// plain Node and is the single place that decides how a raw
// `undergroundInfrastructure` record becomes a drawable object.
//
// DATA-HONESTY RULES (mirror backend spec sections 4, 8-9, 11, 27, 31):
//   - depth / dimensions are only ever reported when the source supplied them —
//     `drawDepth()` / `dimText()` NEVER invent a value;
//   - a DEMO / RESEARCH / UNVERIFIED record is never called official;
//   - a spatial relationship is never turned into a legal-ownership claim.
// ---------------------------------------------------------------------------

export const M_PER_DEG_LAT = 111_320
export const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Layer vocabulary (spec section 5 / 23). Each explorer layer maps to one or
// more backend `type` values. Visual encoding is deliberately multi-channel —
// colour + object shape + line weight + label — so the scene is legible
// without relying on colour alone (accessibility, spec section 23).
// ---------------------------------------------------------------------------
export const UNDERGROUND_LAYERS = [
  { key: 'METRO', label: 'Metro', types: ['METRO'], color: '#7c3aed', shape: 'tunnel', weight: 6, form: 'Bored tunnel volume' },
  { key: 'WATER', label: 'Water Pipelines', types: ['WATER_PIPELINE'], color: '#2563eb', shape: 'pipe', weight: 3, form: 'Cylindrical pipe' },
  { key: 'SEWER', label: 'Sewerage', types: ['SEWER_PIPELINE'], color: '#a16207', shape: 'pipe', weight: 4, form: 'Large cylindrical pipe' },
  { key: 'STORM', label: 'Stormwater', types: ['STORMWATER_DRAIN'], color: '#0891b2', shape: 'channel', weight: 4, form: 'Rectangular drainage channel' },
  { key: 'ELEC', label: 'Electrical', types: ['ELECTRICAL'], color: '#dc2626', shape: 'ductbank', weight: 3, form: 'Conduit duct bank' },
  { key: 'TELECOM', label: 'Telecom', types: ['TELECOM'], color: '#0d9488', shape: 'ductbank', weight: 2, form: 'Grouped cable ducts' },
  { key: 'TUNNEL', label: 'Tunnels', types: ['TUNNEL'], color: '#475569', shape: 'tunnel', weight: 6, form: 'Tunnel volume' },
  { key: 'OTHER', label: 'Other Authorized Utilities', types: ['GAS', 'UTILITY_DUCT', 'MANHOLE', 'CHAMBER', 'OTHER'], color: '#b45309', shape: 'box', weight: 3, form: 'Duct / chamber / other' },
]

const LAYER_BY_TYPE = UNDERGROUND_LAYERS.reduce((m, l) => {
  l.types.forEach((t) => { m[t] = l })
  return m
}, {})

export const layerForType = (type) => LAYER_BY_TYPE[type] || UNDERGROUND_LAYERS[UNDERGROUND_LAYERS.length - 1]
export const layerByKey = (key) => UNDERGROUND_LAYERS.find((l) => l.key === key) || null

// ---------------------------------------------------------------------------
// Local ENU projection about an origin { lon, lat }. Returns [east, north] in
// metres — the SAME tangent-plane convention the rest of the project uses
// (data/geo.js, BuildingScene.jsx). Not a new coordinate system.
// ---------------------------------------------------------------------------
export function toLocalMeters(coord, origin) {
  if (!Array.isArray(coord) || !origin) return [0, 0]
  const [lon, lat] = coord
  return [(lon - origin.lon) * mPerDegLon(origin.lat), (lat - origin.lat) * M_PER_DEG_LAT]
}

/** Centroid { lon, lat } of a GeoJSON geometry (Point / LineString / Polygon). */
export function geometryCentroid(geometry) {
  if (!geometry) return null
  const acc = { lon: 0, lat: 0, n: 0 }
  const add = ([lon, lat]) => {
    if (finite(lon) && finite(lat)) { acc.lon += lon; acc.lat += lat; acc.n += 1 }
  }
  if (geometry.type === 'Point') add(geometry.coordinates)
  else if (geometry.type === 'LineString') geometry.coordinates.forEach(add)
  else if (geometry.type === 'Polygon') (geometry.coordinates[0] || []).forEach(add)
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((p) => (p[0] || []).forEach(add))
  return acc.n ? { lon: acc.lon / acc.n, lat: acc.lat / acc.n } : null
}

// ---------------------------------------------------------------------------
// Depth that is SAFE to draw, in metres positive-downwards. Returns
// { value, known, basis }. NEVER invents a number (spec sections 8-9, 31):
// when the record carries no reliable Z the caller must show "Unavailable"
// and render the object in the explicit "depth unavailable" tray.
// ---------------------------------------------------------------------------
export function drawDepth(rec) {
  const d = numOrNull(rec?.depthBelowSurfaceM)
  if (d != null) return { value: d, known: true, basis: 'DEPTH_BELOW_SURFACE' }
  const surf = numOrNull(rec?.surfaceElevationM)
  const top = numOrNull(rec?.topElevationM)
  if (surf != null && top != null) return { value: Number((surf - top).toFixed(3)), known: true, basis: 'SURFACE_MINUS_TOP' }
  return { value: null, known: false, basis: 'UNKNOWN' }
}

/** Vertical thickness of the drawn object (m) — diameter, else height, else a small default. */
export function drawThickness(rec) {
  const d = numOrNull(rec?.diameterM)
  if (d != null) return Math.max(d, 0.05)
  const h = numOrNull(rec?.heightM)
  if (h != null) return Math.max(h, 0.05)
  return 0.4
}

/** Horizontal width of the drawn object (m) — width, else diameter, else default. */
export function drawWidth(rec) {
  const w = numOrNull(rec?.widthM)
  if (w != null) return Math.max(w, 0.05)
  const d = numOrNull(rec?.diameterM)
  if (d != null) return Math.max(d, 0.05)
  return 0.5
}

// ---------------------------------------------------------------------------
// Provenance (spec section 27). A record is DEMO unless it is explicitly
// official/authorized. This is the ONLY place the explorer decides that.
// ---------------------------------------------------------------------------
const NON_OFFICIAL = new Set(['DEMO', 'RESEARCH', 'UNVERIFIED', 'UPLOADED_SURVEY', 'UNAVAILABLE'])

export const isDemoRecord = (rec) =>
  !rec?.isOfficial || NON_OFFICIAL.has(String(rec?.verificationStatus || 'UNVERIFIED').toUpperCase())

export function provenanceView(rec) {
  const demo = isDemoRecord(rec)
  return {
    source: rec?.source || 'UNVERIFIED',
    provenance: demo ? 'DEMO' : (rec?.source || 'OFFICIAL'),
    verificationStatus: rec?.verificationStatus || 'UNVERIFIED',
    isOfficial: Boolean(rec?.isOfficial) && !demo,
    timestamp: rec?.timestamp || rec?.createdAt || null,
    note: rec?.provenanceNote || null,
    demo,
  }
}

/** A dimension string, or the literal "Unavailable" — never a fabricated value. */
export const dimText = (v, unit = 'm') => {
  const n = numOrNull(v)
  return n != null ? `${n} ${unit}` : 'Unavailable'
}

/** mm form for pipe diameters, used in the info panel. */
export const diameterText = (rec) => {
  const n = numOrNull(rec?.diameterM)
  return n != null ? `${Math.round(n * 1000)} mm` : 'Unavailable'
}

// ---------------------------------------------------------------------------
// Search (spec section 21). Matches infrastructure id, ULPIN, building id,
// locality and type — substring, case-insensitive.
// ---------------------------------------------------------------------------
export function matchInfra(rec, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  return [
    rec.infrastructureId, rec.type, rec.subtype, rec.ownerAuthority,
    rec.parentParcelULPIN, rec.parentParcel, rec.parentBuilding, rec.locality,
  ].filter(Boolean).some((f) => String(f).toLowerCase().includes(s))
}

/** Group rows into the fixed layer list, preserving every layer even when empty. */
export function groupByLayer(rows = []) {
  const buckets = new Map(UNDERGROUND_LAYERS.map((l) => [l.key, []]))
  for (const r of rows) buckets.get(layerForType(r.type).key).push(r)
  return UNDERGROUND_LAYERS.map((l) => ({ layer: l, items: buckets.get(l.key) }))
}

// ---------------------------------------------------------------------------
// Depth-slider visibility (spec section 9). Given the slider depth and mode,
// decide whether a record at `depth` metres is shown / dimmed / highlighted.
// `depth` is positive-downwards; a record with unknown depth is only shown in
// "Show All" and "Surface + Underground".
// ---------------------------------------------------------------------------
export function depthVisibility({ depth, sliceDepth, mode }) {
  const known = depth != null
  if (mode === 'ALL') return { visible: true, dim: false, highlight: false }
  if (mode === 'SURFACE_UNDERGROUND') return { visible: true, dim: false, highlight: false }
  if (!known) return { visible: false, dim: false, highlight: false }
  if (mode === 'DEEP') {
    return { visible: depth >= sliceDepth, dim: false, highlight: false }
  }
  // SLICE — reveal everything down to the slider, spotlight the band around it
  const band = 1.5
  if (depth > sliceDepth + band) return { visible: false, dim: false, highlight: false }
  const highlight = Math.abs(depth - sliceDepth) <= band
  return { visible: true, dim: !highlight, highlight }
}

export const DEPTH_MODES = [
  { key: 'ALL', label: 'Show All' },
  { key: 'SLICE', label: 'Depth Slice' },
  { key: 'DEEP', label: 'Deep Infrastructure' },
  { key: 'SURFACE_UNDERGROUND', label: 'Surface + Underground' },
]

export const VIEW_MODES = [
  { key: 'CUTAWAY', label: 'Cutaway View' },
  { key: 'SURFACE', label: 'Surface View' },
  { key: 'UNDERGROUND', label: 'Underground View' },
]
