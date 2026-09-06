// Phase 9 — deterministic parser + structural validator for the canonical
// Proposed 3D Property Identifier. Backend-authoritative: the frontend may
// pre-validate for UX, but every write path re-parses here.
//
// The parser NEVER "repairs" a malformed identifier and NEVER resolves a
// collision by silently changing components (spec sections 5, 13). It returns
// an explicit { ok, parts, errors[] } result.

import {
  SCHEME_PREFIX, NA_ULPIN, CANONICAL_DELIMITER, COMPONENT_COUNT,
  COMPONENT_ORDER, COMPONENT_PATTERNS, formatCanonical, normaliseVersion,
} from './format.js'

export class IdentifierParseError extends Error {}

/**
 * Parse a canonical identifier string.
 * @param {string} input
 * @returns {{ ok:boolean, canonical:string|null, parts:object|null, errors:string[] }}
 */
export function parseCanonical(input) {
  const errors = []
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, canonical: null, parts: null, errors: ['identifier is empty'] }

  // Upper-case the whole string except the trailing version token, which is
  // lower-case `v<n>` by definition.
  const tokens = raw.split(CANONICAL_DELIMITER)

  if (tokens.length !== COMPONENT_COUNT) {
    errors.push(`expected ${COMPONENT_COUNT} ":"-separated components, found ${tokens.length}`)
    return { ok: false, canonical: null, parts: null, errors }
  }

  const [prefix, ulpinTok, bTok, fTok, uTok, vTok, verTok] = tokens

  if (prefix.trim().toUpperCase() !== SCHEME_PREFIX) {
    errors.push(`component 1 must be the scheme prefix "${SCHEME_PREFIX}" (got "${prefix}")`)
  }

  // The 2nd component is the "parcel key": an Official ULPIN when one exists,
  // otherwise an internal prototype parcel reference (e.g. PCL-CHN-SHLN-0001),
  // or the literal NA for a hypothetical parcel-less validation.
  const parcelKeyTok = ulpinTok.trim().toUpperCase()
  const parcelKeyIsNA = parcelKeyTok === NA_ULPIN
  const officialULPIN = parcelKeyIsNA ? null : parcelKeyTok
  if (!parcelKeyIsNA && !COMPONENT_PATTERNS.officialULPIN.test(parcelKeyTok)) {
    errors.push(`parcel key "${ulpinTok}" is not a plausible identifier token (uppercase alphanumerics/dashes, 3–32 chars) — use an Official ULPIN, an internal prototype parcel reference, or "NA" (a fake Official ULPIN is never generated)`)
  }

  const buildingSegment = bTok.trim().toUpperCase()
  if (!COMPONENT_PATTERNS.buildingSegment.test(buildingSegment)) errors.push(`buildingSegment "${bTok}" must match B<dd> (e.g. B01)`)

  const floorSegment = fTok.trim().toUpperCase()
  if (!COMPONENT_PATTERNS.floorSegment.test(floorSegment)) errors.push(`floorSegment "${fTok}" must match F<dd> (F00 = ground)`)

  const unitSegment = uTok.trim().toUpperCase()
  if (!COMPONENT_PATTERNS.unitSegment.test(unitSegment)) errors.push(`unitSegment "${uTok}" must match U<1..12 alphanumerics> (e.g. U201)`)

  const volumeId = vTok.trim().toUpperCase()
  if (!COMPONENT_PATTERNS.volumeId.test(volumeId)) errors.push(`volumeId "${vTok}" must match V<2..4 digits> (the Phase-2 prototype volume id, e.g. V0201)`)

  const geometryVersion = normaliseVersion(verTok)
  if (!COMPONENT_PATTERNS.geometryVersion.test(geometryVersion)) errors.push(`geometryVersion "${verTok}" must match v<1..4 digits> (e.g. v1)`)

  if (errors.length) return { ok: false, canonical: null, parts: null, errors }

  const parts = {
    officialULPIN, // the parcel key from the canonical (ULPIN or internal ref); null only when the token is NA
    parcelKey: officialULPIN,
    parcelKeyIsNA,
    buildingSegment,
    buildingNumber: Number(buildingSegment.slice(1)),
    floorSegment,
    floorNumber: Number(floorSegment.slice(1)),
    unitSegment,
    apartmentNumber: unitSegment.slice(1),
    volumeId,
    geometryVersion,
  }
  // Idempotent round-trip — the canonical form is the single source of truth.
  const canonical = formatCanonical({
    officialULPIN: officialULPIN ?? NA_ULPIN,
    buildingSegment, floorSegment, unitSegment, volumeId, geometryVersion,
  })
  return { ok: true, canonical, parts, errors: [] }
}

/** Throwing variant for internal call sites that require a valid identifier. */
export function parseCanonicalOrThrow(input) {
  const r = parseCanonical(input)
  if (!r.ok) throw new IdentifierParseError(`Malformed Proposed 3D Property Identifier: ${r.errors.join('; ')}`)
  return r
}

export { COMPONENT_ORDER }
