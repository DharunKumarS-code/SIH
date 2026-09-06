// Phase 8 — parse an uploaded underground-infrastructure file (GeoJSON / CSV /
// JSON) into a flat array of raw infrastructure records.
//
// Deterministic, no external CSV/GIS library — the accepted formats are simple
// enough that a small hand-rolled parser is safer than a dependency (spec
// section 17). Output rows only ever carry the fixed CORE_FIELDS +
// METADATA_FIELDS allowlist — no other key from the source file can reach a
// stored document, which is what makes this safe against prototype pollution /
// unexpected-key injection from an untrusted upload.
//
// Do NOT introduce a PostGIS or QGIS runtime dependency (spec section 17).

export class ParseError extends Error {}

// The minimum consistent underground infrastructure model (spec section 5).
export const CORE_FIELDS = [
  'infrastructureId', 'type', 'subtype', 'ownerAuthority', 'status',
  'source', 'verificationStatus', 'timestamp',
]

// Additional fields supported where available (spec section 5). Never required,
// never fabricated when absent.
export const METADATA_FIELDS = [
  'crs', 'inputCRS', 'horizontalDatum', 'verticalDatum', 'verticalReference',
  'epoch', 'surfaceElevationM', 'topElevationM', 'bottomElevationM',
  'depthBelowSurfaceM', 'depthReference', 'diameterM', 'widthM', 'heightM',
  'parentParcel', 'parentBuilding', 'controlPointId', 'surveySessionId',
  'referenceStation', 'surveyMethod', 'reportedAccuracyM', 'confidence',
  'reviewRequired', 'legalOwnership', 'provenanceNote', 'notes',
  // CSV convenience columns for a point / simple 2-point line
  'latitude', 'longitude', 'elevation', 'depth',
  'lat2', 'lon2',
]

const ALL_FIELDS = new Set([...CORE_FIELDS, ...METADATA_FIELDS])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const NUMERIC_FIELDS = new Set([
  'surfaceElevationM', 'topElevationM', 'bottomElevationM', 'depthBelowSurfaceM',
  'diameterM', 'widthM', 'heightM', 'reportedAccuracyM', 'confidence',
  'latitude', 'longitude', 'elevation', 'depth', 'lat2', 'lon2', 'epoch',
])
const BOOL_FIELDS = new Set(['reviewRequired'])

function coerce(key, value) {
  if (value === '' || value === undefined || value === null) return null
  if (BOOL_FIELDS.has(key)) {
    const s = String(value).trim().toLowerCase()
    return ['1', 'true', 'yes', 'y'].includes(s)
  }
  if (!NUMERIC_FIELDS.has(key)) return value
  const n = Number(value)
  return Number.isFinite(n) ? n : value // keep the raw (invalid) value so validation can flag it
}

function sanitiseRow(raw, fieldMap = {}) {
  const row = {}
  for (const target of ALL_FIELDS) {
    const sourceKey = fieldMap[target] || target
    if (UNSAFE_KEYS.has(sourceKey)) continue
    if (!Object.prototype.hasOwnProperty.call(raw, sourceKey)) continue
    row[target] = coerce(target, raw[sourceKey])
  }
  return row
}

// --------------------------------------------------------------------- CSV
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1 } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * CSV: one row per infrastructure object. A CSV cannot carry a full LineString
 * path, so it supports a point (latitude/longitude[/elevation|depth]) or a
 * simple two-point line (latitude,longitude -> lat2,lon2). Richer geometry must
 * be supplied as GeoJSON.
 */
export function parseCsv(text, fieldMap = {}) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) throw new ParseError('CSV file is empty.')
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  if (header.some((h) => UNSAFE_KEYS.has(h))) throw new ParseError('CSV header contains an unsafe column name.')
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i])
    const raw = {}
    header.forEach((h, idx) => { if (!UNSAFE_KEYS.has(h)) raw[h] = cells[idx] })
    const row = sanitiseRow(raw, fieldMap)
    row.geometry = csvGeometry(row)
    rows.push(row)
  }
  return rows
}

function csvGeometry(row) {
  const lon = row.longitude
  const lat = row.latitude
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (Number.isFinite(row.lon2) && Number.isFinite(row.lat2)) {
    return { type: 'LineString', coordinates: [[lon, lat], [row.lon2, row.lat2]] }
  }
  return { type: 'Point', coordinates: [lon, lat] }
}

// -------------------------------------------------------------------- JSON
export function parseJson(text, fieldMap = {}) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ParseError(`Malformed JSON: ${e.message}`)
  }
  const arr = Array.isArray(data) ? data
    : Array.isArray(data?.infrastructure) ? data.infrastructure
      : Array.isArray(data?.items) ? data.items
        : null
  if (!arr) throw new ParseError('JSON must be an array, or { "infrastructure": [...] }.')
  return arr.map((raw) => {
    const obj = raw && typeof raw === 'object' ? raw : {}
    const row = sanitiseRow(obj, fieldMap)
    row.geometry = normaliseGeometry(obj.geometry) || csvGeometry(row)
    return row
  })
}

// ---------------------------------------------------------------- GeoJSON
export function parseGeoJson(text, fieldMap = {}) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ParseError(`Malformed GeoJSON: ${e.message}`)
  }
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new ParseError('GeoJSON must be a FeatureCollection of Point / LineString / Polygon features.')
  }
  return data.features.map((f) => {
    const props = f?.properties && typeof f.properties === 'object' ? f.properties : {}
    const row = sanitiseRow(props, fieldMap)
    row.geometry = normaliseGeometry(f?.geometry)
    // GeoJSON top-level "crs" member (RFC 7946 deprecated it, but real exports
    // still carry it) — only read it if the feature didn't set one.
    if (!row.crs && !row.inputCRS && data.crs?.properties?.name) row.crs = data.crs.properties.name
    return row
  })
}

/** Accept only Point / LineString / Polygon; strip anything else to null so validation flags it. */
function normaliseGeometry(g) {
  if (!g || typeof g !== 'object') return null
  if (g.type === 'Point' && Array.isArray(g.coordinates)) return { type: 'Point', coordinates: g.coordinates }
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) return { type: 'LineString', coordinates: g.coordinates }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return { type: 'Polygon', coordinates: g.coordinates }
  return null
}

const PARSERS = { csv: parseCsv, json: parseJson, geojson: parseGeoJson }

/**
 * @param {string} text    file content (utf-8 decoded)
 * @param {string} format  'csv' | 'json' | 'geojson'
 * @param {object} [fieldMap]  { targetField: sourceColumnName }
 * @returns {object[]} sanitised raw rows (values not yet validated)
 */
export function parseInfrastructure(text, format, fieldMap = {}) {
  const fmt = String(format || '').toLowerCase()
  const parser = PARSERS[fmt]
  if (!parser) throw new ParseError(`Unsupported format "${format}". Expected csv, json or geojson.`)
  if (!text || !text.trim()) throw new ParseError('File is empty.')
  const safeMap = {}
  for (const [k, v] of Object.entries(fieldMap || {})) {
    if (ALL_FIELDS.has(k) && typeof v === 'string' && !UNSAFE_KEYS.has(v)) safeMap[k] = v
  }
  return parser(text, safeMap)
}
