// Parse an uploaded GNSS/CORS control-point file (CSV / JSON / GeoJSON) into a
// flat array of raw point objects. Deterministic, no external CSV library —
// the format is simple enough that a small hand-rolled parser is safer than a
// dependency here (spec section 22: prevent malicious files, unsafe object
// keys, prototype pollution).
//
// Output rows only ever carry the fixed CORE_FIELDS + METADATA_FIELDS
// allowlist (see below) — no other key from the source file can reach a
// stored document, which is what makes this safe against prototype pollution
// / unexpected-key injection from an untrusted upload.

export class ParseError extends Error {}

// The normalised control-point contract (spec section 2).
export const CORE_FIELDS = [
  'controlPointId', 'latitude', 'longitude', 'height', 'accuracy',
  'coordinateReferenceSystem', 'timestamp', 'source', 'surveyMethod',
]

// Optional metadata (spec section 2) — never required, never fabricated if absent.
export const METADATA_FIELDS = [
  'horizontalAccuracy', 'verticalAccuracy', 'accuracyUnit', 'horizontalDatum',
  'verticalDatum', 'epoch', 'antennaHeight', 'observationDuration', 'fixStatus',
  'satelliteCount', 'pdop', 'correctionSource', 'referenceStation', 'operator',
  'surveySessionId', 'provenance', 'verificationStatus',
]

const ALL_FIELDS = new Set([...CORE_FIELDS, ...METADATA_FIELDS])

// Prevent prototype-pollution / dunder-key injection regardless of source.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const NUMERIC_FIELDS = new Set([
  'latitude', 'longitude', 'height', 'accuracy', 'horizontalAccuracy', 'verticalAccuracy',
  'antennaHeight', 'observationDuration', 'satelliteCount', 'pdop',
])

function toNumberOrRaw(key, value) {
  if (value === '' || value === undefined || value === null) return null
  if (!NUMERIC_FIELDS.has(key)) return value
  const n = Number(value)
  return Number.isFinite(n) ? n : value // keep the raw (invalid) value so validation can flag it, never silently drop
}

/** Build a sanitised row from an arbitrary source object + an optional field-name map. */
function sanitiseRow(raw, fieldMap = {}) {
  const row = {}
  for (const target of ALL_FIELDS) {
    const sourceKey = fieldMap[target] || target
    if (UNSAFE_KEYS.has(sourceKey)) continue
    if (!Object.prototype.hasOwnProperty.call(raw, sourceKey)) continue
    row[target] = toNumberOrRaw(target, raw[sourceKey])
  }
  return row
}

// --------------------------------------------------------------------- CSV
function parseCsvLine(line) {
  // Minimal RFC4180 field splitter — handles quoted fields with embedded commas.
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1 } else { inQuotes = false }
      } else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function parseCsv(text, fieldMap = {}) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) throw new ParseError('CSV file is empty.')
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  if (UNSAFE_KEYS.has(header.find((h) => UNSAFE_KEYS.has(h)))) {
    throw new ParseError('CSV header contains an unsafe column name.')
  }
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i])
    const raw = {}
    header.forEach((h, idx) => { if (!UNSAFE_KEYS.has(h)) raw[h] = cells[idx] })
    rows.push(sanitiseRow(raw, fieldMap))
  }
  return rows
}

// -------------------------------------------------------------------- JSON
export function parseJson(text, fieldMap = {}) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ParseError(`Malformed JSON: ${e.message}`)
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.controlPoints) ? data.controlPoints : null
  if (!arr) throw new ParseError('JSON must be an array of control points, or { "controlPoints": [...] }.')
  return arr.map((raw) => sanitiseRow(raw && typeof raw === 'object' ? raw : {}, fieldMap))
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
    throw new ParseError('GeoJSON must be a FeatureCollection of Point features.')
  }
  return data.features.map((f) => {
    const props = f?.properties && typeof f.properties === 'object' ? f.properties : {}
    const coords = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null
    const raw = { ...props }
    if (Array.isArray(coords)) {
      if (raw.longitude === undefined && !fieldMap.longitude) raw.longitude = coords[0]
      if (raw.latitude === undefined && !fieldMap.latitude) raw.latitude = coords[1]
      if (raw.height === undefined && !fieldMap.height && coords[2] !== undefined) raw.height = coords[2]
    }
    return sanitiseRow(raw, fieldMap)
  })
}

const PARSERS = { csv: parseCsv, json: parseJson, geojson: parseGeoJson }

/**
 * @param {string} text        file content (already decoded as utf-8)
 * @param {string} format      'csv' | 'json' | 'geojson'
 * @param {object} [fieldMap]  { targetField: sourceColumnName } — for CSV/JSON headers that differ from the core contract
 * @returns {object[]} sanitised raw rows (values not yet validated)
 */
export function parseControlPoints(text, format, fieldMap = {}) {
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
