import { z } from 'zod'
import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError, badRequest } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'

/* ------------------------------------------------------------------ parcels */

export const listParcels = asyncHandler(async (req, res) => {
  const { landUse, status, q, limit } = req.query
  const filter = {}
  if (landUse) filter.landUse = landUse
  if (status) filter.status = status
  if (q) filter.$or = [{ ulpin: { $regex: q } }, { parcelId: { $regex: q } }, { surveyNumber: { $regex: q } }]
  const rows = await db.collection('parcels').find(filter, { sort: { parcelId: 1 }, limit: limit ? Number(limit) : undefined })
  list(res, rows, { total: await db.collection('parcels').count(filter) })
})

export const getParcel = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No parcel for ULPIN ${ulpin}`)
  const [buildings, landUse, registration, encumbrance, tax, disputes] = await Promise.all([
    db.collection('buildings').find({ ulpin }, { sort: { buildingNumber: 1 } }),
    db.collection('landUse').findOne({ ulpin }),
    db.collection('registrations').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('encumbrances').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('propertyTax').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('disputes').find({ ulpin }),
  ])
  ok(res, {
    parcel,
    landUse,
    registration,
    encumbrance,
    propertyTax: tax,
    disputes,
    buildings: buildings.map((b) => ({
      buildingId: b.buildingId,
      buildingSegment: b.buildingSegment,
      name: b.name,
      shortName: b.shortName,
      totalFloors: b.totalFloors,
      unitCount: b.unitCount,
      constructionStatus: b.constructionStatus,
    })),
  })
})

export const createParcelSchema = {
  body: z.object({
    ulpin: z.string().regex(/^[A-Z]{2}-[A-Z]{3}-\d{6,12}$/, 'ULPIN must look like TN-CHN-123456789'),
    parcelId: z.string().min(3),
    surveyNumber: z.string().min(1),
    village: z.string().default('Sholinganallur'),
    taluk: z.string().default('Sholinganallur'),
    district: z.string().default('Chengalpattu'),
    landUse: z.string().default('Primary Residential'),
    geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.array(z.number()))) }),
  }),
}

export const createParcel = asyncHandler(async (req, res) => {
  const body = req.body
  if (await db.collection('parcels').findOne({ ulpin: body.ulpin })) {
    throw badRequest(`Parcel ${body.ulpin} already exists`)
  }
  const parcel = {
    ...body,
    isOfficialUlpin: true,
    status: 'Under Review',
    ownershipStatus: 'Under Review',
    registrationStatus: 'Pending',
    encumbranceStatus: 'Nil',
    propertyTaxStatus: 'Not Assessed',
    buildingStatus: 'Vacant plot',
    isDemo: true,
    createdBy: req.user?.username,
    createdAt: new Date().toISOString(),
  }
  await db.collection('parcels').create(parcel)
  await db.collection('ulpins').create({
    ulpin: body.ulpin,
    parcelId: body.parcelId,
    kind: 'Parcel ULPIN',
    isOfficial: true,
    issuedOn: new Date().toISOString(),
    issuingAuthority: 'Prototype registry',
    status: 'Active',
  })
  await recordAudit({ user: req.user?.username, action: 'PARCEL_CREATED', entityType: 'Parcel', entityId: body.ulpin, ip: req.ip })
  ok(res, { parcel })
})

export const verifyParcel = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError()
  const updated = await db.collection('parcels').updateOne({ ulpin }, { status: 'Verified', ownershipStatus: 'Verified' })
  await recordAudit({
    user: req.user?.username,
    action: 'PARCEL_VERIFIED',
    entityType: 'Parcel',
    entityId: ulpin,
    before: { status: parcel.status },
    after: { status: 'Verified' },
    ip: req.ip,
  })
  ok(res, { parcel: updated })
})

/* -------------------------------------------------------------------- ulpins */

export const listUlpins = asyncHandler(async (_req, res) => {
  list(res, await db.collection('ulpins').find({}, { sort: { ulpin: 1 } }))
})

export const getUlpin = asyncHandler(async (req, res) => {
  const row = await db.collection('ulpins').findOne({ ulpin: req.params.ulpin })
  if (!row) throw notFoundError()
  ok(res, row)
})

/* ----------------------------------------------------------------------- gis */

const asFeature = (geometry, properties) => ({ type: 'Feature', geometry, properties })
const asFC = (features) => ({ type: 'FeatureCollection', features })

export const gisParcels = asyncHandler(async (_req, res) => {
  const rows = await db.collection('parcels').find({})
  ok(res, asFC(rows.map((p) => asFeature(p.geometry, {
    ulpin: p.ulpin,
    parcelId: p.parcelId,
    landUse: p.landUse,
    status: p.status,
    areaSqft: p.areaSqft,
    isDemo: p.isDemo,
    layer: 'parcels',
  }))))
})

export const gisBuildings = asyncHandler(async (_req, res) => {
  const rows = await db.collection('buildings').find({})
  ok(res, asFC(rows.map((b) => asFeature(b.geometry, {
    buildingId: b.buildingId,
    name: b.name,
    ulpin: b.ulpin,
    heightM: b.heightM,
    baseElevationM: b.baseElevationM,
    totalFloors: b.totalFloors,
    unitCount: b.unitCount,
    constructionStatus: b.constructionStatus,
    isDemo: b.isDemo,
    layer: 'buildings',
  }))))
})

export const gisUnits = asyncHandler(async (req, res) => {
  const { buildingId, floorNumber, ulpin } = req.query
  const filter = {}
  if (buildingId) filter.buildingId = buildingId
  if (ulpin) filter.ulpin = ulpin
  if (floorNumber != null) filter.floorNumber = Number(floorNumber)
  const rows = await db.collection('propertyUnits').find(filter)
  ok(res, asFC(rows.map((u) => asFeature(u.geometry, {
    propertyId: u.propertyId,
    unitId: u.unitId,
    apartmentNumber: u.apartmentNumber,
    buildingId: u.buildingId,
    buildingSegment: u.buildingSegment,
    floorNumber: u.floorNumber,
    floorSegment: u.floorSegment,
    baseHeight: u.baseHeight,
    topHeight: u.topHeight,
    usage: u.usage,
    status: u.status,
    bedrooms: u.bedrooms,
    owner: u.owner?.name,
    idKind: u.idKind,
    isDemo: u.isDemo,
    layer: 'units',
  }))))
})

export const gisCommonAreas = asyncHandler(async (req, res) => {
  const filter = req.query.buildingId ? { buildingId: req.query.buildingId } : {}
  const rows = await db.collection('commonAreas').find(filter)
  ok(res, asFC(rows.map((c) => asFeature(c.geometry, {
    commonAreaId: c.commonAreaId,
    type: c.type,
    name: c.name,
    buildingId: c.buildingId,
    baseHeight: c.baseHeight,
    topHeight: c.topHeight,
    ownership: c.ownership,
    isDemo: c.isDemo,
    layer: 'common-areas',
  }))))
})

export const gisLayer = asyncHandler(async (req, res) => {
  const map = {
    roads: 'roads',
    utilities: 'utilities',
    environment: 'environment',
    boundaries: 'boundaries',
    'master-plan': 'masterPlans',
    disputes: 'disputes',
  }
  const col = map[req.params.layer]
  if (!col) throw notFoundError(`Unknown GIS layer "${req.params.layer}"`)
  const rows = await db.collection(col).find({})
  ok(res, asFC(rows.map((r) => asFeature(r.geometry, { ...r, geometry: undefined, layer: req.params.layer }))))
})
