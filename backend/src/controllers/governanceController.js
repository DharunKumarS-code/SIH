import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError } from '../utils/http.js'
import { adapters, unifiedRecord } from '../services/adapters/index.js'
import { listLandSources } from '../services/landData/index.js'

const scoped = (ulpin, propertyId) =>
  propertyId ? { $or: [{ propertyId }, { ulpin, scope: 'Parcel' }] } : { ulpin }

export const getRoR = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No Record of Rights for ${ulpin}`)
  const owners = await db.collection('propertyUnits').distinct('owner.name', { ulpin })
  ok(res, {
    ulpin,
    recordOfRights: {
      surveyNumber: parcel.surveyNumber,
      village: parcel.village,
      taluk: parcel.taluk,
      district: parcel.district,
      classification: parcel.classification,
      extentSqft: parcel.areaSqft,
      ownershipStatus: parcel.ownershipStatus,
      mutationStatus: parcel.registrationStatus,
      encumbranceStatus: parcel.encumbranceStatus,
      unitOwners: owners.filter(Boolean).length,
    },
    isDemo: true,
  })
})

export const getRegistration = asyncHandler(async (req, res) => {
  const rows = await db.collection('registrations').find(scoped(req.params.ulpin, req.query.propertyId))
  if (!rows.length) throw notFoundError('No registration records')
  list(res, rows)
})

export const getEncumbrance = asyncHandler(async (req, res) => {
  const rows = await db.collection('encumbrances').find(scoped(req.params.ulpin, req.query.propertyId))
  ok(res, { ulpin: req.params.ulpin, records: rows, status: rows.some((r) => r.status === 'Active') ? 'Encumbered' : 'Clear', isDemo: true })
})

export const getPropertyTax = asyncHandler(async (req, res) => {
  const rows = await db.collection('propertyTax').find(scoped(req.params.ulpin, req.query.propertyId))
  if (!rows.length) throw notFoundError('No property tax records')
  const due = rows.reduce((s, r) => s + (r.dueAmountRs || 0), 0)
  ok(res, { ulpin: req.params.ulpin, assessments: rows, totalDueRs: due, status: due ? 'Due' : 'Paid', isDemo: true })
})

export const getBuildingApproval = asyncHandler(async (req, res) => {
  const row = await db.collection('buildingApprovals').findOne({ buildingId: req.params.buildingId })
  if (!row) throw notFoundError(`No approval on record for ${req.params.buildingId}`)
  ok(res, row)
})

export const getLandUse = asyncHandler(async (req, res) => {
  const row = await db.collection('landUse').findOne({ ulpin: req.params.ulpin })
  if (!row) throw notFoundError()
  ok(res, row)
})

export const getMasterPlan = asyncHandler(async (_req, res) => {
  list(res, await db.collection('masterPlans').find({}))
})

/** Cross-department interoperable record for one ULPIN (§17 /api + §18). */
export const getUnifiedRecord = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`Unknown ULPIN ${ulpin}`)
  ok(res, await unifiedRecord(ulpin, { propertyId: req.query.propertyId }))
})

/** Single department adapter passthrough — demonstrates the standard envelope. */
export const getDepartmentView = asyncHandler(async (req, res) => {
  const adapter = adapters[req.params.department]
  if (!adapter) throw notFoundError(`Unknown department "${req.params.department}"`)
  ok(res, await adapter.fetch(req.params.ulpin, { propertyId: req.query.propertyId, buildingId: req.query.buildingId }))
})

/* ---------------------------------------------------------------------------
 * Phase 10 — Governance overview. A READ-ONLY roll-up of what already exists
 * across the platform (data-source registry, data-quality validation runs,
 * pending reviews, governance/service requests, documents, audit trail). It
 * fabricates no government integration and creates no new authoritative data.
 * ------------------------------------------------------------------------- */
export const getGovernanceOverview = asyncHandler(async (_req, res) => {
  const [
    sources, parcels, buildings, units,
    topoRuns, infraRuns, gnssProposals, geomProposals,
    aiJobs, serviceRequests, documents, auditLogs,
    undergroundInfra, identifiers,
  ] = await Promise.all([
    Promise.resolve(listLandSources()),
    db.collection('parcels').count({}),
    db.collection('buildings').count({}),
    db.collection('propertyUnits').count({}),
    db.collection('topologyValidationResults').find({}, { sort: { createdAt: -1 }, limit: 1, projection: { findings: 0 } }),
    db.collection('infrastructureValidationResults').find({}, { sort: { createdAt: -1 }, limit: 1, projection: { findings: 0 } }),
    db.collection('geometryReviewProposals').find({ reviewStatus: 'PENDING_REVIEW' }),
    db.collection('geometryReviewProposals').find({}),
    db.collection('aiJobs').find({}, { sort: { createdAt: -1 }, limit: 200 }),
    db.collection('serviceRequests').find({}),
    db.collection('documents').count({}),
    db.collection('auditLogs').find({}, { sort: { at: -1 }, limit: 12 }),
    db.collection('undergroundInfrastructure').count({}),
    db.collection('proposed3DPropertyIdentifiers').count({}),
  ])

  const openServices = serviceRequests.filter((s) => !['Approved', 'Rejected'].includes(s.status)).length
  const pendingAiReview = aiJobs.filter((j) => j.status === 'PROCESSING' || j.reviewRequired).length
  const latestTopo = topoRuns[0] || null
  const latestInfra = infraRuns[0] || null

  ok(res, {
    generatedAt: new Date().toISOString(),
    isDemo: true,
    disclaimer:
      'Governance overview. Read-only roll-up of existing platform records. No live government connectivity; ' +
      'Land Records / Registration / Property Tax integrations are DEMO / MOCK adapters. No authoritative data is created here.',
    dataSources: {
      chennaiAvailability: sources.chennai?.status || sources.availability?.status || 'UNAVAILABLE',
      registered: (sources.sources || []).length,
      sources: sources.sources || [],
      summary: sources.chennai?.summary || sources.availability?.summary || null,
    },
    holdings: { parcels, buildings, units, undergroundInfrastructure: undergroundInfra, proposed3DIdentifiers: identifiers },
    dataQuality: {
      topology: latestTopo ? { runId: latestTopo.validationRunId, scopeType: latestTopo.scopeType, overallStatus: latestTopo.summary?.overallStatus || null, summary: latestTopo.summary || null, createdAt: latestTopo.createdAt } : null,
      infrastructure: latestInfra ? { runId: latestInfra.validationRunId, scopeType: latestInfra.scopeType, overallStatus: latestInfra.summary?.overallStatus || null, summary: latestInfra.summary || null, createdAt: latestInfra.createdAt } : null,
    },
    pendingReviews: {
      geometryProposals: gnssProposals.length,
      geometryProposalsTotal: geomProposals.length,
      aiJobs: pendingAiReview,
      total: gnssProposals.length + pendingAiReview,
    },
    governanceRequests: {
      total: serviceRequests.length,
      open: openServices,
      byStatus: serviceRequests.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m }, {}),
    },
    documents: { total: documents, note: 'Demo document cards only — see docs/06-security-framework.md.' },
    audit: { recent: auditLogs.map(({ _id, ...r }) => r) },
  })
})
