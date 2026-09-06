// Phase 9 — deterministic validation for a Proposed 3D Property Identifier.
//
// REUSES the Phase 7 STATUS / SEVERITY vocabulary and finding shape
// (spec section 35) — it does NOT re-implement Phase 2 or Phase 7 geometry
// rules; it references their results. Every finding is explainable and never
// mutates anything.

import { db } from '../../store/index.js'
import { STATUS, SEVERITY } from '../topology/severity.js'
import { parseCanonical } from './parse.js'
import { assertSingleActive } from './versions.js'
import { resolveHierarchy } from './resolve.js'

export { STATUS, SEVERITY }

const RANK = { VALID: 0, WARNING: 1, REVIEW_REQUIRED: 2, ERROR: 3 }
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a)

export const IDENTIFIER_RULE_DEFAULTS = {
  ID3D_MALFORMED_IDENTIFIER: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_MISSING_OFFICIAL_ULPIN: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.LOW },
  ID3D_FABRICATED_OFFICIAL_ULPIN: { status: STATUS.ERROR, severity: SEVERITY.CRITICAL },
  ID3D_PARCEL_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_BUILDING_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_FLOOR_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_UNIT_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_VOLUME_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_BROKEN_PARENT_RELATIONSHIP: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_VOLUME_ID_MISMATCH: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_INVALID_GEOMETRY_REFERENCE: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_GEOMETRY_WARNING: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  ID3D_GEOMETRY_ERROR: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_GEOMETRY_VERSION_NOT_FOUND: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_INVALID_VERSION: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  ID3D_DUPLICATE_ACTIVE_VERSION: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_DUPLICATE_IDENTIFIER: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_DUPLICATE_VOLUME_ASSIGNMENT: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_CONFLICTING_HIERARCHY: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  ID3D_MISSING_PROVENANCE: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.MEDIUM },
  ID3D_UNSUPPORTED_STATUS: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  ID3D_TOPOLOGY_ERROR_ON_HIERARCHY: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.MEDIUM },
}

let seq = Date.now() % 1_000_000
const nextId = () => {
  seq += 1
  return `ID3DFIND-${Date.now().toString(36).toUpperCase()}-${String(seq).padStart(6, '0')}`
}

function finding(ruleId, message, extra = {}) {
  const d = IDENTIFIER_RULE_DEFAULTS[ruleId] || { status: STATUS.WARNING, severity: SEVERITY.MEDIUM }
  return {
    validationId: nextId(),
    ruleId,
    status: extra.status || d.status,
    severity: extra.severity || d.severity,
    message,
    entityType: extra.entityType || 'PROPOSED_3D_IDENTIFIER',
    entityId: extra.entityId || null,
    suggestedFix: extra.suggestedFix || null,
    createdAt: new Date().toISOString(),
  }
}

const ALLOWED_IDENTIFIER_STATUS = new Set(['PROPOSED', 'DRAFT', 'DEPRECATED'])

/**
 * Validate a Proposed 3D Property Identifier.
 *
 * @param {object} input
 * @param {string} [input.canonicalIdentifier]  a canonical string to validate
 * @param {object} [input.parts]                pre-parsed parts (alternative to a string)
 * @param {string} [input.internalParcelRef]    when officialULPIN is NA
 * @param {string} [input.geometryVersionEntity] 'VOLUME' (default)
 * @param {string} [input.status]               proposed record status
 * @param {string} [input.source]               provenance source
 * @param {string} [input.identifierId]         when re-validating a stored record (self-collision is ignored)
 * @returns {{ overallStatus, findings, resolved, canonical }}
 */
export async function validateIdentifier(input = {}) {
  const findings = []
  let parts = input.parts || null
  let canonical = input.canonicalIdentifier || null

  // ---- 1. structural / parser ----
  if (canonical || !parts) {
    const parsed = parseCanonical(canonical || '')
    if (!parsed.ok) {
      findings.push(finding('ID3D_MALFORMED_IDENTIFIER', `Identifier is malformed: ${parsed.errors.join('; ')}`, {
        suggestedFix: 'Use 3DPR:<officialULPIN|NA>:B<dd>:F<dd>:U<unit>:V<dddd>:v<n>.',
      }))
      return { overallStatus: STATUS.ERROR, findings, resolved: null, canonical: null }
    }
    parts = parsed.parts
    canonical = parsed.canonical
  }

  // ---- 2. Official ULPIN presence (never fabricate) ----
  // `input.officialULPIN` (when the caller passes it — e.g. a stored record)
  // is the source of truth for "does a real Official ULPIN exist". Otherwise
  // infer from the canonical's parcel-key token.
  const declaredOfficialULPIN = input.officialULPIN !== undefined
    ? input.officialULPIN
    : (parts.parcelKeyIsNA ? null : parts.officialULPIN)
  if (!declaredOfficialULPIN) {
    findings.push(finding('ID3D_MISSING_OFFICIAL_ULPIN', 'Official ULPIN is NOT AVAILABLE for this property — an internal prototype parcel reference is used. The identifier stays PROPOSED / non-official and a fake Official ULPIN is never generated.', {
      status: STATUS.REVIEW_REQUIRED,
    }))
  } else if (input.claimOfficial === true) {
    // A caller trying to assert the identifier itself is an official ULPIN.
    findings.push(finding('ID3D_FABRICATED_OFFICIAL_ULPIN', 'The Proposed 3D Property Identifier can never be marked as an Official ULPIN. The Official ULPIN belongs to the parcel and keeps its own provenance.'))
  }

  // ---- 3. record status must be a supported PROPOSED-family value ----
  if (input.status && !ALLOWED_IDENTIFIER_STATUS.has(String(input.status).toUpperCase())) {
    findings.push(finding('ID3D_UNSUPPORTED_STATUS', `status "${input.status}" is not supported (allowed: ${[...ALLOWED_IDENTIFIER_STATUS].join(', ')}). It is never OFFICIAL/AUTHORIZED.`))
  }
  if (!input.source) {
    findings.push(finding('ID3D_MISSING_PROVENANCE', 'No provenance source supplied for the identifier record.'))
  }

  // ---- 4. hierarchy resolution ----
  const resolved = await resolveHierarchy(parts, { internalParcelRef: input.internalParcelRef })

  const parcelKey = parts.officialULPIN || input.internalParcelRef || null
  if (parcelKey && !resolved.found.parcel && !parts.parcelKeyIsNA) {
    findings.push(finding('ID3D_PARCEL_NOT_FOUND', `No parcel resolves for "${parcelKey}" (tried Official ULPIN and internal parcel reference).`, { entityId: parcelKey }))
  }
  if ((!parcelKey || parts.parcelKeyIsNA) && !resolved.found.parcel) {
    findings.push(finding('ID3D_PARCEL_NOT_FOUND', 'The identifier names no parcel (NA) and no internalParcelRef was supplied — the hierarchy cannot be resolved.', {
      suggestedFix: 'Supply an Official ULPIN or an internal prototype parcel reference.',
    }))
  }
  if (resolved.found.parcel && !resolved.found.building) {
    findings.push(finding('ID3D_BUILDING_NOT_FOUND', `Building ${parts.buildingSegment} does not exist on parcel ${resolved.parcel.parcelId}.`, { entityId: parts.buildingSegment }))
  }
  if (resolved.found.building && !resolved.found.floor) {
    findings.push(finding('ID3D_FLOOR_NOT_FOUND', `Floor ${parts.floorSegment} does not exist in building ${resolved.building.buildingId}.`, { entityId: parts.floorSegment }))
  }
  if (resolved.found.building && !resolved.found.unit) {
    findings.push(finding('ID3D_UNIT_NOT_FOUND', `Unit ${parts.unitSegment} does not exist on ${parts.buildingSegment}/${parts.floorSegment}.`, { entityId: parts.unitSegment }))
  }

  // ---- 5. parent-relationship consistency ----
  if (resolved.found.building && resolved.parcel && resolved.building.ulpin !== resolved.parcel.ulpin) {
    findings.push(finding('ID3D_BROKEN_PARENT_RELATIONSHIP', `Building ${resolved.building.buildingId} belongs to ULPIN ${resolved.building.ulpin}, not ${resolved.parcel.ulpin}.`))
  }
  if (resolved.found.floor && resolved.building && resolved.floor.buildingId !== resolved.building.buildingId) {
    findings.push(finding('ID3D_BROKEN_PARENT_RELATIONSHIP', `Floor ${resolved.floor.floorId} is not in building ${resolved.building.buildingId}.`))
  }
  if (resolved.found.unit && resolved.building && resolved.unit.buildingId !== resolved.building.buildingId) {
    findings.push(finding('ID3D_BROKEN_PARENT_RELATIONSHIP', `Unit ${resolved.unit.propertyId} is not in building ${resolved.building.buildingId}.`))
  }
  if (resolved.found.unit && resolved.found.floor && resolved.unit.floorId !== resolved.floor.floorId) {
    findings.push(finding('ID3D_CONFLICTING_HIERARCHY', `Unit ${resolved.unit.propertyId} is on floor ${resolved.unit.floorId}, but the identifier names ${resolved.floor.floorId}.`))
  }

  // ---- 6. volume + geometry ----
  if (resolved.found.unit && !resolved.volume) {
    findings.push(finding('ID3D_VOLUME_NOT_FOUND', `Unit ${resolved.unit.propertyId} has no resolvable prototype 3D volume.`))
  }
  if (resolved.found.unit && resolved.volume && resolved.volumeIdMatches === false) {
    findings.push(finding('ID3D_VOLUME_ID_MISMATCH', `Identifier names volume ${parts.volumeId}, but unit ${resolved.unit.propertyId} resolves to volume ${resolved.volume.volumeId}.`, {
      suggestedFix: `Use ${resolved.volume.volumeId} as the volume component.`,
    }))
  }
  const geomStatus = resolved.unitVolumeValidation?.status
  if (geomStatus === 'ERROR') {
    findings.push(finding('ID3D_GEOMETRY_ERROR', `Phase-2 geometry validation reports ERROR for the referenced volume: ${(resolved.unitVolumeValidation.issues || []).map((i) => i.rule).join(', ')}.`))
  } else if (geomStatus === 'WARNING') {
    findings.push(finding('ID3D_GEOMETRY_WARNING', `Phase-2 geometry validation reports WARNING for the referenced volume: ${(resolved.unitVolumeValidation.issues || []).map((i) => i.rule).join(', ')}.`))
  }

  // ---- 7. geometry version ----
  if (resolved.volume && !resolved.found.geometryVersion) {
    findings.push(finding('ID3D_GEOMETRY_VERSION_NOT_FOUND', `Geometry version ${parts.geometryVersion} does not exist for volume ${resolved.volume.volumeId}.`, {
      suggestedFix: 'Create the geometry version first (POST /api/3d-identifiers/:id/versions) or reference an existing one.',
    }))
  }
  if (resolved.geometryVersions.length) {
    const sa = assertSingleActive(resolved.geometryVersions)
    if (!sa.ok) {
      findings.push(finding('ID3D_DUPLICATE_ACTIVE_VERSION', `Volume ${resolved.volume.volumeId} has ${sa.activeCount} ACTIVE geometry versions (${sa.activeVersions.join(', ')}). Exactly one must be ACTIVE.`))
    }
  }

  // ---- 8. identifier uniqueness / duplicate volume assignment ----
  if (canonical) {
    const dupes = await db.collection('proposed3DPropertyIdentifiers').find({ canonicalIdentifier: canonical })
    const others = dupes.filter((d) => d.identifierId !== input.identifierId)
    if (others.length) {
      findings.push(finding('ID3D_DUPLICATE_IDENTIFIER', `Canonical identifier ${canonical} already exists (${others.map((d) => d.identifierId).join(', ')}). Collisions are reported, never silently renamed.`))
    }
  }
  if (resolved.building && resolved.volume?.volumeId && parts.geometryVersion) {
    // The Phase-2 volumeId is only unique WITHIN a building, so a duplicate
    // volume assignment is only a conflict when the SAME building's SAME volume
    // @ the SAME version is claimed by two different units.
    const sameVol = await db.collection('proposed3DPropertyIdentifiers').find({
      buildingId: resolved.building.buildingId,
      volumeId: resolved.volume.volumeId,
      geometryVersion: parts.geometryVersion,
    })
    const conflicting = sameVol.filter((d) => d.identifierId !== input.identifierId
      && d.propertyId && resolved.unit && d.propertyId !== resolved.unit.propertyId)
    if (conflicting.length) {
      findings.push(finding('ID3D_DUPLICATE_VOLUME_ASSIGNMENT', `Volume ${resolved.volume.volumeId} @ ${parts.geometryVersion} in building ${resolved.building.buildingId} is already assigned to a different unit by ${conflicting.map((d) => d.identifierId).join(', ')}.`))
    }
  }

  // ---- 9. Phase-7 topology reference (read-only, PARCEL-scoped) ----
  // Only a persisted topology run for THIS parcel (not a locality-wide run) is
  // surfaced — a defect in a neighbouring parcel must not taint this identifier.
  // Trigger a fresh parcel-scoped run explicitly via POST .../revalidate.
  if (resolved.parcel) {
    const [run] = await db.collection('topologyValidationResults').find(
      { scopeType: 'parcel', scopeId: resolved.parcel.ulpin },
      { sort: { createdAt: -1 }, limit: 1 },
    )
    if (run && run.summary?.overallStatus === 'ERROR') {
      findings.push(finding('ID3D_TOPOLOGY_ERROR_ON_HIERARCHY', `The latest Phase-7 topology run for parcel ${resolved.parcel.ulpin} reports overall status ERROR (run ${run.validationRunId}). Review the linked hierarchy geometry.`))
    }
  }

  const overallStatus = findings.reduce((s, f) => worst(s, f.status), STATUS.VALID)
  return { overallStatus, findings, resolved, canonical }
}

/**
 * Map a validation outcome + geometry state to the stored record's
 * `geometryStatus` (spec section 14).
 */
export function deriveGeometryStatus(validation) {
  const rules = new Set(validation.findings.map((f) => f.ruleId))
  if (rules.has('ID3D_VOLUME_NOT_FOUND') || rules.has('ID3D_VOLUME_ID_MISMATCH') || rules.has('ID3D_GEOMETRY_VERSION_NOT_FOUND')) {
    return 'INVALID_GEOMETRY_REFERENCE'
  }
  if (rules.has('ID3D_GEOMETRY_ERROR')) return 'ERROR'
  if (rules.has('ID3D_GEOMETRY_WARNING')) return 'WARNING'
  if (validation.overallStatus === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED'
  if (validation.overallStatus === 'ERROR') return 'ERROR'
  return 'VALID'
}
