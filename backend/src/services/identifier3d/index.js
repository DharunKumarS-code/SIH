// Phase 9 — Proposed 3D Property Identifier orchestrator (additive).
//
//   canonical string / hierarchy refs
//     -> parse (parse.js)                         deterministic, backend-authoritative
//     -> resolve (resolve.js)                     reuse Phase 2 volume + Phase 5/6/8 refs
//     -> validate (validate.js)                   reuse Phase 7 STATUS/SEVERITY + result shape
//     -> proposed3DPropertyIdentifiers  (Mongo, additive)
//     -> geometryVersions               (Mongo, additive; history NEVER destroyed)
//
// TERMINOLOGY (non-negotiable — spec sections 3, 44):
//   Official ULPIN  = government / authoritative PARCEL identifier. Untouched.
//   Proposed 3D Property Identifier = this application's RESEARCH / PROTOTYPE
//     cross-hierarchy reference. status is always PROPOSED. NEVER "Official ULPIN",
//     NEVER a government-approved 3D ULPIN standard.

import { db } from '../../store/index.js'
import { recordAudit } from '../auditService.js'
import { unitVolume } from '../geometry3d/index.js'
import {
  SCHEME_PREFIX, NA_ULPIN, IDENTIFIER_LABEL, IDENTIFIER_LABEL_ALT, IDENTIFIER_STATUS,
  COMPONENT_PATTERNS, COMPONENT_ORDER, formatCanonical,
  buildingSegmentOf, floorSegmentOf, unitSegmentOf,
} from './format.js'
import { parseCanonical, parseCanonicalOrThrow, IdentifierParseError } from './parse.js'
import { validateIdentifier, deriveGeometryStatus, STATUS } from './validate.js'
import { resolveHierarchy, relatedUndergroundInfrastructure, surveyReferences } from './resolve.js'
import {
  listVersions, getVersion, createVersion, transitionVersion, VERSION_STATUSES,
} from './versions.js'
import {
  IDENTIFIER_DISCLAIMER, STANDARDIZATION_NOTE, LEGAL_STATUS_VALUES, conceptualVolumetricRights,
} from './constants.js'

export {
  formatCanonical, parseCanonical, parseCanonicalOrThrow, IdentifierParseError,
  validateIdentifier, deriveGeometryStatus, resolveHierarchy, listVersions, getVersion,
  createVersion, transitionVersion, IDENTIFIER_LABEL, IDENTIFIER_LABEL_ALT,
  IDENTIFIER_DISCLAIMER, STANDARDIZATION_NOTE, LEGAL_STATUS_VALUES, conceptualVolumetricRights,
}

let seq = Date.now() % 100000
const nextIdentifierId = () => {
  seq += 1
  return `P3DI-${String(seq).padStart(6, '0')}`
}

const strip = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

/** GET /api/3d-identifiers/config */
export function identifierConfig() {
  return {
    label: IDENTIFIER_LABEL,
    labelAlt: IDENTIFIER_LABEL_ALT,
    status: IDENTIFIER_STATUS,
    schemePrefix: SCHEME_PREFIX,
    naSentinel: NA_ULPIN,
    canonicalFormat: `${SCHEME_PREFIX}:<officialULPIN|${NA_ULPIN}>:B<dd>:F<dd>:U<unit>:V<dddd>:v<n>`,
    componentOrder: ['schemePrefix', ...COMPONENT_ORDER],
    componentPatterns: Object.fromEntries(Object.entries(COMPONENT_PATTERNS).map(([k, v]) => [k, v.source])),
    versionStatuses: VERSION_STATUSES,
    legalStatusValues: LEGAL_STATUS_VALUES,
    officialUlpinNote:
      'The Official ULPIN is the authoritative PARCEL identifier and keeps its own provenance. Every seeded ' +
      'parcel in this prototype has ulpinStatus DEMO_NOT_OFFICIAL — a real government ULPIN is never fabricated.',
    isOfficial: false,
    disclaimer: IDENTIFIER_DISCLAIMER,
    standardizationNote: STANDARDIZATION_NOTE,
  }
}

/** Build the full "resolved reference" payload for one identifier record. */
async function assembleResolved(record) {
  const parsed = parseCanonical(record.canonicalIdentifier)
  const parts = parsed.ok ? parsed.parts : null
  const validation = await validateIdentifier({
    canonicalIdentifier: record.canonicalIdentifier,
    officialULPIN: record.officialULPIN, // null for an internal-ref record — the source of truth
    internalParcelRef: record.internalParcelRef || undefined,
    status: record.status,
    source: record.source,
    identifierId: record.identifierId,
  })
  const resolved = validation.resolved
  const [underground, survey] = resolved
    ? await Promise.all([relatedUndergroundInfrastructure(resolved), surveyReferences(resolved)])
    : [[], null]

  return {
    ...strip(record),
    label: IDENTIFIER_LABEL,
    status: IDENTIFIER_STATUS,
    isOfficial: false,
    // ---- Official ULPIN — separate, authoritative, untouched ----
    officialULPIN: record.officialULPIN,
    officialULPINStatus: resolved?.officialULPINStatus || record.officialULPINStatus || 'NOT_AVAILABLE',
    officialULPINVerified: Boolean(resolved?.officialULPINVerified),
    officialULPINDisplay: record.officialULPIN
      ? `${record.officialULPIN} (${resolved?.officialULPINStatus || 'DEMO_NOT_OFFICIAL'})`
      : 'NOT AVAILABLE',
    // ---- hierarchy ----
    hierarchy: resolved ? {
      parcel: resolved.parcel,
      building: resolved.building,
      floor: resolved.floor,
      unit: resolved.unit,
      volume: resolved.volume,
      geometryVersion: resolved.geometryVersion,
      found: resolved.found,
      volumeIdMatches: resolved.volumeIdMatches ?? null,
    } : null,
    geometryVersions: resolved?.geometryVersions || [],
    unitVolumeValidation: resolved?.unitVolumeValidation || null,
    // ---- validation / geometry health ----
    validation: { overallStatus: validation.overallStatus, findings: validation.findings },
    geometryStatus: deriveGeometryStatus(validation),
    // ---- rights model — conceptual only ----
    legalStatus: record.legalStatus || 'NOT_ESTABLISHED',
    ownershipStatus: record.ownershipStatus || 'NOT_PROVIDED',
    rightsStatus: record.rightsStatus || 'NOT_ESTABLISHED',
    encumbranceStatus: record.encumbranceStatus || 'NOT_PROVIDED',
    conceptualVolumetricRights: record.conceptualVolumetricRights || conceptualVolumetricRights(record.volumeId),
    // ---- cross-phase references ----
    surveyReferences: survey,
    relatedUndergroundInfrastructure: underground,
    // ---- focus hint for the EXISTING Cesium viewer (reuses unit selection) ----
    focusRef: resolved?.unit ? {
      kind: 'unit',
      propertyId: resolved.unit.propertyId,
      buildingId: resolved.unit.buildingId,
      floorNumber: resolved.unit.floorNumber,
      ulpin: resolved.unit.ulpin,
      locality: resolved.parcel?.locality || record.locality || null,
    } : null,
    disclaimer: IDENTIFIER_DISCLAIMER,
  }
}

/** GET one identifier by identifierId OR canonicalIdentifier. */
export async function getIdentifier(idOrCanonical) {
  const key = String(idOrCanonical || '')
  let record = await db.collection('proposed3DPropertyIdentifiers').findOne({ identifierId: key })
  if (!record) {
    const parsed = parseCanonical(key)
    if (parsed.ok) record = await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: parsed.canonical })
  }
  if (!record) return null
  return assembleResolved(record)
}

export async function listIdentifiers(query = {}) {
  const filter = {}
  if (query.ulpin) filter.officialULPIN = String(query.ulpin).toUpperCase()
  if (query.buildingId) filter.buildingId = query.buildingId
  if (query.floorId) filter.floorId = query.floorId
  if (query.unitId) filter.propertyId = query.unitId
  if (query.propertyId) filter.propertyId = query.propertyId
  if (query.volumeId) filter.volumeId = String(query.volumeId).toUpperCase()
  if (query.geometryVersion) filter.geometryVersion = query.geometryVersion
  if (query.status) filter.status = query.status
  if (query.locality) filter.locality = query.locality
  const rows = await db.collection('proposed3DPropertyIdentifiers').find(filter, {
    sort: { createdAt: -1 }, limit: query.limit ? Number(query.limit) : undefined,
  })
  return rows.map(strip)
}

/** Lightweight search — canonical id, ULPIN, or any hierarchy component. */
export async function searchIdentifiers(q, { limit = 12 } = {}) {
  const raw = String(q || '').trim()
  if (raw.length < 2) return []
  const results = []

  // exact canonical match first
  const parsed = parseCanonical(raw)
  if (parsed.ok) {
    const rec = await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: parsed.canonical })
    if (rec) results.push(rec)
  }
  const rx = { $regex: raw, $options: 'i' }
  const more = await db.collection('proposed3DPropertyIdentifiers').find({
    $or: [
      { canonicalIdentifier: rx }, { identifierId: rx }, { officialULPIN: rx },
      { buildingId: rx }, { floorId: rx }, { propertyId: rx }, { volumeId: rx },
      { geometryVersion: rx }, { buildingSegment: rx }, { unitSegment: rx },
    ],
  }, { limit })
  for (const m of more) if (!results.some((r) => r.identifierId === m.identifierId)) results.push(m)
  return results.slice(0, limit).map(strip)
}

/**
 * Create a Proposed 3D Property Identifier from either a canonical string or
 * explicit hierarchy refs. Deterministic: identical hierarchy+version always
 * yields the same canonicalIdentifier. A collision is REPORTED, never resolved
 * by silently changing the identifier (spec section 13).
 */
export async function createIdentifier(input = {}, { user } = {}) {
  let canonical = input.canonicalIdentifier || null
  let parts

  if (canonical) {
    const parsed = parseCanonical(canonical)
    if (!parsed.ok) throw new IdentifierParseError(`Malformed identifier: ${parsed.errors.join('; ')}`)
    parts = parsed.parts
    canonical = parsed.canonical
  } else {
    // Build from refs. Resolve the entities so we can derive the exact segments.
    const ulpin = input.officialULPIN ? String(input.officialULPIN).toUpperCase() : null
    // Parcel key used in the canonical: the Official ULPIN when one exists,
    // otherwise the internal prototype parcel reference (spec section 6).
    const canonicalParcelKey = ulpin
      || (input.internalParcelRef ? String(input.internalParcelRef).toUpperCase() : null)
    const buildingSegment = input.buildingSegment
      || (input.buildingNumber != null ? buildingSegmentOf(input.buildingNumber) : null)
    let floorSegment = input.floorSegment
      || (input.floorNumber != null ? floorSegmentOf(input.floorNumber) : null)
    let unitSegment = input.unitSegment
      || (input.apartmentNumber != null ? unitSegmentOf(input.apartmentNumber) : null)
    let volumeId = input.volumeId ? String(input.volumeId).toUpperCase() : null
    const geometryVersion = input.geometryVersion || 'v1'

    // If a propertyId is given, derive everything authoritatively from it.
    if (input.propertyId) {
      const unit = await db.collection('propertyUnits').findOne({ propertyId: input.propertyId })
      if (!unit) throw new IdentifierParseError(`No unit ${input.propertyId}`)
      const building = await db.collection('buildings').findOne({ buildingId: unit.buildingId })
      const parcel = await db.collection('parcels').findOne({ ulpin: unit.ulpin })
      const vol = unitVolume(unit)
      parts = {
        officialULPIN: ulpin
          || (input.internalParcelRef ? String(input.internalParcelRef).toUpperCase() : (parcel ? parcel.ulpin.toUpperCase() : null)),
        buildingSegment: building?.buildingSegment || buildingSegment,
        floorSegment: `F${String(unit.floorNumber).padStart(2, '0')}`,
        unitSegment: `U${String(unit.apartmentNumber).toUpperCase()}`,
        volumeId: (vol?.volumeId || volumeId || '').toUpperCase(),
        geometryVersion,
        buildingNumber: building?.buildingNumber,
        floorNumber: unit.floorNumber,
        apartmentNumber: String(unit.apartmentNumber).toUpperCase(),
      }
    } else {
      if (!buildingSegment || !floorSegment || !unitSegment || !volumeId) {
        throw new IdentifierParseError('Provide either canonicalIdentifier, propertyId, or the full set { buildingSegment/Number, floorSegment/Number, unitSegment/apartmentNumber, volumeId }.')
      }
      parts = {
        officialULPIN: canonicalParcelKey,
        buildingSegment: buildingSegment.toUpperCase(),
        floorSegment: floorSegment.toUpperCase(),
        unitSegment: unitSegment.toUpperCase(),
        volumeId: volumeId.toUpperCase(),
        geometryVersion,
        buildingNumber: Number(buildingSegment.replace(/\D/g, '')),
        floorNumber: Number(floorSegment.replace(/\D/g, '')),
        apartmentNumber: unitSegment.slice(1).toUpperCase(),
      }
    }
    canonical = formatCanonical({
      officialULPIN: parts.officialULPIN ?? NA_ULPIN,
      buildingSegment: parts.buildingSegment,
      floorSegment: parts.floorSegment,
      unitSegment: parts.unitSegment,
      volumeId: parts.volumeId,
      geometryVersion: parts.geometryVersion,
    })
  }

  // ---- baseline geometry version (spec sections 9-10) ----
  // A brand-new identifier for `v1` is the thing that establishes that unit's
  // first geometry version. Create it BEFORE validation so `v1` resolves; a
  // `v2+` reference with no prior history is still a genuine error.
  const preResolve = await resolveHierarchy(parts, { internalParcelRef: input.internalParcelRef })
  if (preResolve.unit?.propertyId && parts.geometryVersion === 'v1') {
    const existing = await listVersions('VOLUME', preResolve.unit.propertyId)
    if (!existing.length) {
      await createVersion({
        entityType: 'VOLUME', entityId: preResolve.unit.propertyId,
        source: input.source || 'DEMO',
        reason: 'Baseline geometry version created with the proposed identifier.',
        geometryRef: { kind: 'VOLUME', id: parts.volumeId, unitPropertyId: preResolve.unit.propertyId, buildingId: preResolve.building?.buildingId },
        user,
      })
    }
  }

  // ---- validate BEFORE persisting (spec section 7: no valid id for a broken hierarchy) ----
  const validation = await validateIdentifier({
    canonicalIdentifier: canonical,
    officialULPIN: input.officialULPIN,
    internalParcelRef: input.internalParcelRef,
    status: input.status || 'PROPOSED',
    source: input.source || 'DEMO',
    claimOfficial: input.claimOfficial === true,
  })

  // A collision or a broken hierarchy is a hard failure — reported, not fixed.
  const blocking = validation.findings.filter((f) => f.status === STATUS.ERROR)
  if (blocking.length) {
    const err = new Error(`Cannot create identifier: ${blocking.map((f) => f.ruleId).join(', ')}`)
    err.status = 409
    err.findings = validation.findings
    err.canonical = canonical
    throw err
  }

  const resolved = validation.resolved
  const now = new Date().toISOString()
  // The canonical's parcel-key resolved either by Official ULPIN or by an
  // internal prototype parcel reference. Only the former is a real Official
  // ULPIN; the latter is stored as internalParcelRef with officialULPIN null.
  const resolvedByUlpin = Boolean(resolved?.found?.parcel) && resolved.officialULPINStatus !== 'NOT_AVAILABLE' && !parts.parcelKeyIsNA
  const storedOfficialULPIN = input.officialULPIN
    ? String(input.officialULPIN).toUpperCase()
    : (resolvedByUlpin ? parts.officialULPIN : null)
  const storedInternalRef = input.internalParcelRef
    || (!resolvedByUlpin && parts.officialULPIN && !parts.parcelKeyIsNA ? parts.officialULPIN : null)
  const doc = {
    identifierId: nextIdentifierId(),
    canonicalIdentifier: canonical,
    label: IDENTIFIER_LABEL,
    // ---- Official ULPIN kept separate + never marked official by us ----
    officialULPIN: storedOfficialULPIN,
    officialULPINStatus: storedOfficialULPIN
      ? (resolved?.officialULPINStatus && resolved.officialULPINStatus !== 'NOT_AVAILABLE' ? resolved.officialULPINStatus : 'DEMO_NOT_OFFICIAL')
      : 'NOT_AVAILABLE',
    officialULPINVerified: Boolean(storedOfficialULPIN && resolved?.officialULPINVerified),
    internalParcelRef: storedInternalRef,
    // ---- hierarchy pointers (references, not copies) ----
    parcelId: resolved?.parcel?.parcelId || null,
    buildingId: resolved?.building?.buildingId || null,
    buildingSegment: parts.buildingSegment,
    floorId: resolved?.floor?.floorId || null,
    floorSegment: parts.floorSegment,
    unitId: resolved?.unit?.unitId || null,
    propertyId: resolved?.unit?.propertyId || null,
    unitSegment: parts.unitSegment,
    volumeId: parts.volumeId,
    geometryVersion: parts.geometryVersion,
    // ---- provenance — never OFFICIAL ----
    status: IDENTIFIER_STATUS,
    source: input.source || 'DEMO',
    verificationStatus: (input.source === 'AUTHORIZED' || input.source === 'OFFICIAL') ? 'AUTHORIZED' : (input.source || 'DEMO'),
    isOfficial: false,
    provenance: input.provenanceNote || 'Application-generated research / prototype cross-hierarchy reference (not a government identifier).',
    // ---- rights model — conceptual only ----
    legalStatus: 'NOT_ESTABLISHED',
    ownershipStatus: 'NOT_PROVIDED',
    rightsStatus: 'NOT_ESTABLISHED',
    encumbranceStatus: 'NOT_PROVIDED',
    conceptualVolumetricRights: conceptualVolumetricRights(parts.volumeId),
    geometryStatus: deriveGeometryStatus(validation),
    locality: resolved?.parcel?.locality || input.locality || null,
    createdBy: user?.username || null,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection('proposed3DPropertyIdentifiers').create(doc)

  await recordAudit({
    user: user?.username,
    action: 'PROPOSED_3D_IDENTIFIER_CREATED',
    entityType: 'Proposed3DPropertyIdentifier',
    entityId: doc.identifierId,
    after: { canonicalIdentifier: canonical, geometryStatus: doc.geometryStatus },
  })

  return assembleResolved(doc)
}

/** All Proposed 3D identifiers linked to one Official ULPIN (spec section 30). */
export async function identifiersForOfficialUlpin(ulpin) {
  const rows = await db.collection('proposed3DPropertyIdentifiers').find(
    { officialULPIN: String(ulpin).toUpperCase() }, { sort: { createdAt: -1 } },
  )
  return rows.map(strip)
}

export { assembleResolved }
