// Phase 9 — Proposed 3D Property Identifier API (additive).
//
// Every response is explicit that the identifier is a RESEARCH / PROTOTYPE
// reference (status: PROPOSED, isOfficial: false, IDENTIFIER_DISCLAIMER) — it
// is NOT an Official ULPIN and NOT a government-approved 3D ULPIN standard.
// The Official ULPIN belongs to the parcel and keeps its own provenance.

import { db } from '../store/index.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'
import {
  identifierConfig, getIdentifier, listIdentifiers, searchIdentifiers, createIdentifier,
  validateIdentifier, identifiersForOfficialUlpin, listVersions, getVersion,
  createVersion, transitionVersion, deriveGeometryStatus,
  IDENTIFIER_DISCLAIMER, parseCanonical, IdentifierParseError,
} from '../services/identifier3d/index.js'
import { runValidation as runTopologyValidation } from '../services/topology/index.js'

/* --------------------------------------------------------------- config */
export const getConfig = asyncHandler(async (_req, res) => ok(res, identifierConfig()))

/* ------------------------------------------------------------ list / get */
export const listAll = asyncHandler(async (req, res) => {
  const rows = await listIdentifiers(req.query)
  list(res, rows, { total: rows.length, disclaimer: IDENTIFIER_DISCLAIMER })
})

export const getOne = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  ok(res, resolved)
})

export const getHierarchy = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  ok(res, {
    identifierId: resolved.identifierId,
    canonicalIdentifier: resolved.canonicalIdentifier,
    officialULPIN: resolved.officialULPIN,
    officialULPINStatus: resolved.officialULPINStatus,
    officialULPINDisplay: resolved.officialULPINDisplay,
    hierarchy: resolved.hierarchy,
    focusRef: resolved.focusRef,
    geometryStatus: resolved.geometryStatus,
    validation: resolved.validation,
    relatedUndergroundInfrastructure: resolved.relatedUndergroundInfrastructure,
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})

export const getGeometry = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  const h = resolved.hierarchy || {}
  ok(res, {
    identifierId: resolved.identifierId,
    canonicalIdentifier: resolved.canonicalIdentifier,
    // References to EXISTING geometry — never a second copy (spec section 41).
    geometry: {
      parcel: h.parcel?.geometry || null,
      building: h.building?.geometry || null,
      floor: h.floor?.volume || null,
      unit: h.unit?.geometry || null,
      volume: h.volume || null,
    },
    geometryVersion: h.geometryVersion || null,
    geometryStatus: resolved.geometryStatus,
    volumeIdMatches: h.volumeIdMatches,
    unitVolumeValidation: resolved.unitVolumeValidation,
    surveyReferences: resolved.surveyReferences,
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})

/* ------------------------------------------------------------- versions */
export const getVersions = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  const volumeId = resolved.volumeId
  const versions = resolved.propertyId ? await listVersions('VOLUME', resolved.propertyId) : []
  ok(res, {
    identifierId: resolved.identifierId,
    volumeId,
    currentGeometryVersion: resolved.geometryVersion,
    versions, // oldest first; SUPERSEDED / historical rows are ALWAYS retained
    activeVersion: versions.find((v) => v.status === 'ACTIVE')?.geometryVersion || null,
    note: 'Historical geometry versions are never deleted. A finalized version is immutable — a change creates a new version.',
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})

const VERSION_ACTIONS = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'ARCHIVED']

export const addVersion = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  if (!resolved.propertyId) throw badRequest('This identifier has no resolvable unit/volume to version.')
  const doc = await createVersion({
    entityType: 'VOLUME',
    entityId: resolved.propertyId,
    source: req.body?.source || 'DEMO',
    reason: req.body?.reason || null,
    status: req.body?.status,
    makeActive: req.body?.makeActive !== false,
    geometryRef: { kind: 'VOLUME', id: resolved.volumeId, unitPropertyId: resolved.propertyId, buildingId: resolved.buildingId },
    user: req.user,
  })
  ok(res, { ...doc, disclaimer: IDENTIFIER_DISCLAIMER })
})

export const reviewVersion = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  const { geometryVersion, toStatus, reason } = req.body || {}
  const to = String(toStatus || '').toUpperCase()
  if (!VERSION_ACTIONS.includes(to)) throw badRequest(`toStatus must be one of ${VERSION_ACTIONS.join(', ')}`)
  const r = await transitionVersion({ entityType: 'VOLUME', entityId: resolved.propertyId, geometryVersion, toStatus: to, reason, user: req.user })
  if (!r.ok) throw badRequest(r.error)
  ok(res, { ...r.version, disclaimer: IDENTIFIER_DISCLAIMER })
})

/* --------------------------------------------------------------- create */
export const create = asyncHandler(async (req, res) => {
  try {
    const resolved = await createIdentifier(req.body || {}, { user: req.user })
    ok(res, resolved)
  } catch (e) {
    if (e instanceof IdentifierParseError) throw badRequest(e.message)
    if (e.status === 409) {
      // A collision / broken hierarchy is REPORTED — never resolved by silently
      // changing the identifier (spec section 13).
      throw Object.assign(badRequest(e.message), { details: { canonical: e.canonical, findings: e.findings } })
    }
    throw e
  }
})

/* ------------------------------------------------------------ validate */
export const validate = asyncHandler(async (req, res) => {
  const body = req.body || {}
  const result = await validateIdentifier({
    canonicalIdentifier: body.canonicalIdentifier,
    parts: body.parts,
    internalParcelRef: body.internalParcelRef,
    status: body.status,
    source: body.source,
    claimOfficial: body.claimOfficial === true,
  })
  ok(res, {
    canonicalIdentifier: result.canonical,
    overallStatus: result.overallStatus,
    findings: result.findings,
    geometryStatus: deriveGeometryStatus(result),
    resolved: result.resolved
      ? {
          officialULPIN: result.resolved.officialULPIN,
          officialULPINStatus: result.resolved.officialULPINStatus,
          found: result.resolved.found,
          volumeIdMatches: result.resolved.volumeIdMatches ?? null,
        }
      : null,
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})

/* ------------------------------- Phase 7 revalidation (explicit, on demand) */
export const revalidate = asyncHandler(async (req, res) => {
  const resolved = await getIdentifier(req.params.identifierId)
  if (!resolved) throw notFoundError(`No Proposed 3D Property Identifier ${req.params.identifierId}`)
  if (!resolved.officialULPIN && !resolved.hierarchy?.parcel?.ulpin) throw badRequest('No parcel to run topology validation against.')
  const ulpin = resolved.hierarchy?.parcel?.ulpin || resolved.officialULPIN
  const run = await runTopologyValidation({ scopeType: 'parcel', scopeId: ulpin }, { user: req.user })
  await recordAudit({
    user: req.user?.username,
    action: 'PROPOSED_3D_IDENTIFIER_REVALIDATED',
    entityType: 'Proposed3DPropertyIdentifier',
    entityId: resolved.identifierId,
    after: { topologyRunId: run.validationRunId, overallStatus: run.summary?.overallStatus },
  })
  ok(res, {
    identifierId: resolved.identifierId,
    topologyRunId: run.validationRunId,
    topologyStatus: run.summary?.overallStatus || null,
    topologySummary: run.summary || null,
    note: 'Phase 7 topology validation was re-run for the linked parcel and stored. Phase 9 references its result — it does not duplicate the rules.',
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})

/* --------------------------------------------------------------- search */
export const search = asyncHandler(async (req, res) => {
  const rows = await searchIdentifiers(req.query.q, { limit: req.query.limit ? Number(req.query.limit) : 12 })
  ok(res, { query: req.query.q || '', count: rows.length, results: rows, disclaimer: IDENTIFIER_DISCLAIMER })
})

/* ------------------------------- lookup by Official ULPIN (spec section 30) */
export const byOfficialUlpin = asyncHandler(async (req, res) => {
  const parcel = await db.collection('parcels').findOne({ ulpin: req.params.ulpin })
  const rows = await identifiersForOfficialUlpin(req.params.ulpin)
  ok(res, {
    officialULPIN: req.params.ulpin,
    officialULPINResolved: Boolean(parcel),
    officialULPINStatus: parcel ? 'DEMO_NOT_OFFICIAL' : 'UNRESOLVED',
    note: 'The Official ULPIN is the authoritative PARCEL identifier. The list below is this application\'s PROPOSED 3D references linked to it — none of them replace or upgrade the Official ULPIN.',
    proposed3DIdentifiers: rows,
    count: rows.length,
    disclaimer: IDENTIFIER_DISCLAIMER,
  })
})
