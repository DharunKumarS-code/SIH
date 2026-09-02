import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError } from '../utils/http.js'
import { adapters, unifiedRecord } from '../services/adapters/index.js'

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
