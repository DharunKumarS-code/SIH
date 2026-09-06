// ---------------------------------------------------------------------------
// Phase 9 — PROPOSED 3D PROPERTY IDENTIFIER  (a.k.a. "3D Cadastral Reference ID")
//
// A RESEARCH / PROTOTYPE, application-level reference that links an existing
// parcel's Official ULPIN with the project's 3D cadastral hierarchy
// (Building → Floor → Unit → 3D Volume → Geometry Version).
//
// THIS IS NOT AN OFFICIAL GOVERNMENT 3D ULPIN STANDARD. It has NOT been
// approved by the Government of India, Tamil Nadu, DoLR or the Chennai
// Corporation. The Official ULPIN remains the authoritative PARCEL-level
// identifier; this identifier never replaces or renames it.
//
// ---------------------------------------------------------------------------
// CANONICAL FORMAT (deterministic, documented)
//
//   3DPR:<officialULPIN|NA>:<buildingSeg>:<floorSeg>:<unitSeg>:<volumeId>:<geometryVersion>
//
//   3DPR              fixed scheme prefix (case-insensitive on input, upper on output)
//   parcelKey         the parcel's Official ULPIN, uppercased, WHEN one exists;
//                     otherwise the parcel's internal prototype reference
//                     (e.g. PCL-CHN-SHLN-0001) so the canonical stays unique
//                     (spec section 6 — "may use a separate internal prototype
//                     parcel reference"). A fake Official ULPIN is NEVER
//                     generated. The literal token  NA  is also accepted for a
//                     hypothetical parcel-less validation. The STORED record's
//                     `officialULPIN` field (null when absent) — NOT this token
//                     — is the source of truth for "is there a real ULPIN".
//   buildingSeg       B + 2 digits            e.g. B01
//   floorSeg          F + 2 digits (F00 = ground)   e.g. F02
//   unitSeg           U + 1..12 alphanumerics e.g. U201
//   volumeId          V + 2..4 digits (the Phase-2 prototype volume id)  e.g. V0201
//   geometryVersion   v + 1..4 digits         e.g. v1
//
//   Example:  3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v1
//   Example (no ULPIN):  3DPR:NA:B01:F02:U201:V0201:v1
//
// ESCAPING / DELIMITER RULES
//   - ":" is the ONLY delimiter and is RESERVED — it can never appear inside a
//     component. Every component's allowed character set already excludes ":".
//   - Components are positional; there are always exactly 7 tokens.
//   - Input is trimmed and upper-cased before parsing; output is always
//     upper-cased and canonical. Parsing is therefore idempotent:
//     format(parse(s)) === canonical(s).
//   - There is no concatenation without validation — see parse.js.
// ---------------------------------------------------------------------------

export const SCHEME_PREFIX = '3DPR'
export const NA_ULPIN = 'NA' // sentinel — a real ULPIN is never fabricated
export const CANONICAL_DELIMITER = ':'
export const COMPONENT_COUNT = 7 // 3DPR + 6 hierarchy components

// Human-facing labels — used in the UI and docs so the identifier is NEVER
// presented as an "Official ULPIN".
export const IDENTIFIER_LABEL = 'Proposed 3D Property Identifier'
export const IDENTIFIER_LABEL_ALT = '3D Cadastral Reference ID'
export const IDENTIFIER_STATUS = 'PROPOSED' // never OFFICIAL / AUTHORIZED

export const COMPONENT_PATTERNS = {
  // A ULPIN is issued by an authoritative source; we do not constrain it beyond
  // "uppercase alphanumerics and dashes" so a real 14-char ECCMA ULPIN and the
  // project's prototype "TN-CHN-…" parcel ids both validate. It must NOT be
  // empty and must NOT contain the delimiter.
  officialULPIN: /^[A-Z0-9][A-Z0-9-]{2,31}$/,
  buildingSegment: /^B\d{2}$/,
  floorSegment: /^F\d{2}$/,
  unitSegment: /^U[A-Z0-9]{1,12}$/,
  volumeId: /^V\d{2,4}$/,
  geometryVersion: /^v\d{1,4}$/,
}

export const COMPONENT_ORDER = [
  'officialULPIN', 'buildingSegment', 'floorSegment', 'unitSegment', 'volumeId', 'geometryVersion',
]

const clean = (v) => String(v ?? '').trim()

/** Normalise a version to the `v<n>` form. Accepts 1, "1", "v1", "V1". */
export function normaliseVersion(v) {
  const s = clean(v).toLowerCase()
  if (/^v\d{1,4}$/.test(s)) return s
  if (/^\d{1,4}$/.test(s)) return `v${s}`
  return s // left as-is so the validator can reject it
}

/**
 * Build the canonical identifier string from its parts.
 * Throws only on a structurally impossible input (missing required part);
 * all *format* validation is the parser's job so a single code path decides
 * validity — see parse.js / validate.js.
 *
 * @param {object} p
 * @param {string|null} p.officialULPIN  null / '' / 'NA' -> the NA sentinel
 * @param {string} p.buildingSegment
 * @param {string} p.floorSegment
 * @param {string} p.unitSegment
 * @param {string} p.volumeId
 * @param {string|number} p.geometryVersion
 */
export function formatCanonical(p) {
  const ulpinRaw = clean(p.officialULPIN)
  const ulpin = !ulpinRaw || ulpinRaw.toUpperCase() === NA_ULPIN ? NA_ULPIN : ulpinRaw.toUpperCase()
  const parts = [
    SCHEME_PREFIX,
    ulpin,
    clean(p.buildingSegment).toUpperCase(),
    clean(p.floorSegment).toUpperCase(),
    clean(p.unitSegment).toUpperCase(),
    clean(p.volumeId).toUpperCase(),
    normaliseVersion(p.geometryVersion),
  ]
  if (parts.some((x) => x === '' || x == null)) {
    throw new Error('formatCanonical: every component is required (use "NA" for a missing Official ULPIN).')
  }
  return parts.join(CANONICAL_DELIMITER)
}

/** Convenience: derive the segment strings the formatter needs from raw numbers. */
export const buildingSegmentOf = (n) => `B${String(Number(n) || 0).padStart(2, '0')}`
export const floorSegmentOf = (n) => `F${String(Number(n) || 0).padStart(2, '0')}`
export const unitSegmentOf = (apt) => `U${clean(apt).toUpperCase()}`
