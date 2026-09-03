import { z } from 'zod'
import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError, badRequest } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'
import { LOCALITIES, CHENNAI_CITY, localityPublic } from '../data/localities.js'
import { resolveParcel, listLandSources, demoProvenance, subdivisionOf } from '../services/landData/index.js'
import { assembleParcelVolumes, unitVolume } from '../services/geometry3d/index.js'

/* ------------------------------------------------------------------ parcels */

export const listParcels = asyncHandler(async (req, res) => {
  const { landUse, status, q, limit, verificationStatus } = req.query
  const filter = {}
  if (landUse) filter.landUse = landUse
  if (status) filter.status = status
  if (q) filter.$or = [{ ulpin: { $regex: q } }, { parcelId: { $regex: q } }, { surveyNumber: { $regex: q } }]
  const total = await db.collection('parcels').count(filter)
  let rows = await db.collection('parcels').find(filter, { sort: { parcelId: 1 }, limit: limit ? Number(limit) : undefined })
  rows = rows.map((p) => ({ ...p, subdivisionNumber: subdivisionOf(p), provenance: demoProvenance(p) }))
  // Every seeded parcel is DEMO today; the filter is additive for a future mixed dataset.
  if (verificationStatus) rows = rows.filter((p) => p.provenance.verificationStatus === verificationStatus)
  list(res, rows, { total })
})

export const getParcel = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No parcel for ULPIN ${ulpin}`)
  // Keep this endpoint light. The full prototype-volume validation (which needs
  // every floor + unit doc) lives on GET /api/parcels/:ulpin/volumes — here we
  // only report cheap indexed counts so the hot path stays fast.
  const [buildings, landUse, registration, encumbrance, tax, disputes, floorCount, unitCount, resolved] = await Promise.all([
    db.collection('buildings').find({ ulpin }, { sort: { buildingNumber: 1 } }),
    db.collection('landUse').findOne({ ulpin }),
    db.collection('registrations').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('encumbrances').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('propertyTax').findOne({ ulpin, scope: 'Parcel' }),
    db.collection('disputes').find({ ulpin }),
    db.collection('floors').count({ ulpin }),
    db.collection('propertyUnits').count({ ulpin }),
    resolveParcel({ ulpin }),
  ])
  ok(res, {
    // `isOfficialUlpin` in the seed means "parcel-level id" (not a derived unit
    // id) — NOT government-official. Normalise it so nothing downstream misreads
    // a demo id as an official ULPIN; the real signal is `provenance`.
    parcel: { ...parcel, isOfficialUlpin: false, subdivisionNumber: subdivisionOf(parcel) },
    provenance: resolved.provenance,
    providerChain: resolved.providerChain,
    // Phase 2 — prototype 3D volume rollup (counts only; see /volumes for detail + validation).
    volumes: { buildings: buildings.length, floors: floorCount, units: unitCount },
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

// Phase 2 — every prototype 3D volume for a parcel + a validation rollup.
// Sibling of GET /api/parcels/:ulpin/provenance.
export const getParcelVolumes = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No parcel for ULPIN ${ulpin}`)
  const [buildings, floors, units, resolved] = await Promise.all([
    db.collection('buildings').find({ ulpin }, { sort: { buildingNumber: 1 } }),
    db.collection('floors').find({ ulpin }),
    db.collection('propertyUnits').find({ ulpin }),
    resolveParcel({ ulpin }),
  ])
  const source = resolved.provenance?.verificationStatus || 'DEMO'
  let volumes = { buildings: [], floors: [], units: [] }
  let validation = { status: 'VALID', counts: { valid: 0, warning: 0, error: 0 }, issues: [] }
  try {
    ;({ volumes, validation } = assembleParcelVolumes({ parcel, buildings, floors, units, source }))
  } catch (err) {
    // Malformed / missing demo geometry must never 500 this endpoint.
    validation = {
      status: 'ERROR',
      counts: { valid: 0, warning: 0, error: 1 },
      issues: [{ level: 'Parcel', id: ulpin, status: 'ERROR', rule: 'VOLUME_ASSEMBLY', message: `Could not assemble volumes: ${err.message}` }],
    }
  }
  ok(res, { ulpin, provenance: resolved.provenance, volumes, validation })
})

export const getParcelProvenance = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const resolved = await resolveParcel({ ulpin })
  if (!resolved.record) {
    // Still return the provider chain so callers see WHY (UNAVAILABLE vs not found).
    const exists = await db.collection('parcels').findOne({ ulpin })
    if (!exists) throw notFoundError(`No parcel for ULPIN ${ulpin}`)
  }
  ok(res, {
    ulpin,
    provenance: resolved.provenance,
    providerChain: resolved.providerChain,
  })
})

// The register of official ULPIN sources investigated in Phase 1 + the bottom
// line for Chennai. Public — it is documentation, not data.
export const getLandSources = asyncHandler(async (_req, res) => {
  ok(res, {
    ...listLandSources(),
    localities: LOCALITIES.map((l) => ({
      id: l.id,
      name: l.name,
      adminLevel: l.adminLevel || null,
      recordType: l.recordType || null,
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

// ONE Chennai-wide environment: every locality is a cluster within the same
// Cesium scene. `GET /api/gis/localities` drives the area selector + camera.
export const listLocalities = asyncHandler(async (_req, res) => {
  const localities = await Promise.all(
    LOCALITIES.map(async (l) => ({
      ...localityPublic(l),
      counts: {
        parcels: await db.collection('parcels').count({ locality: l.id }),
        buildings: await db.collection('buildings').count({ locality: l.id }),
        units: await db.collection('propertyUnits').count({ locality: l.id }),
      },
    })),
  )
  ok(res, { localities, city: CHENNAI_CITY })
})

export const gisParcels = asyncHandler(async (req, res) => {
  const filter = req.query.locality ? { locality: req.query.locality } : {}
  const rows = await db.collection('parcels').find(filter)
  ok(res, asFC(rows.map((p) => {
    const prov = demoProvenance(p)
    return asFeature(p.geometry, {
      ulpin: p.ulpin,
      parcelId: p.parcelId,
      landUse: p.landUse,
      status: p.status,
      areaSqft: p.areaSqft,
      locality: p.locality,
      verificationStatus: prov.verificationStatus,
      ulpinStatus: prov.ulpinStatus,
      isOfficialUlpin: false,
      isDemo: p.isDemo,
      layer: 'parcels',
    })
  })))
})

export const gisBuildings = asyncHandler(async (req, res) => {
  const filter = req.query.locality ? { locality: req.query.locality } : {}
  const rows = await db.collection('buildings').find(filter)
  ok(res, asFC(rows.map((b) => asFeature(b.geometry, {
    buildingId: b.buildingId,
    name: b.name,
    ulpin: b.ulpin,
    heightM: b.heightM,
    baseElevationM: b.baseElevationM,
    totalFloors: b.totalFloors,
    unitCount: b.unitCount,
    constructionStatus: b.constructionStatus,
    locality: b.locality,
    isDemo: b.isDemo,
    layer: 'buildings',
  }))))
})

export const gisUnits = asyncHandler(async (req, res) => {
  const { buildingId, floorNumber, ulpin, locality } = req.query
  const filter = {}
  if (buildingId) filter.buildingId = buildingId
  if (ulpin) filter.ulpin = ulpin
  if (locality) filter.locality = locality
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
    locality: u.locality,
    // Phase 2 — prototype 3D volume bounds ride along so the viewer needs no 2nd call.
    volume: unitVolume(u),
    isDemo: u.isDemo,
    layer: 'units',
  }))))
})

export const gisCommonAreas = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.buildingId) filter.buildingId = req.query.buildingId
  if (req.query.locality) filter.locality = req.query.locality
  const rows = await db.collection('commonAreas').find(filter)
  ok(res, asFC(rows.map((c) => asFeature(c.geometry, {
    commonAreaId: c.commonAreaId,
    type: c.type,
    name: c.name,
    buildingId: c.buildingId,
    baseHeight: c.baseHeight,
    topHeight: c.topHeight,
    ownership: c.ownership,
    locality: c.locality,
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
  const filter = req.query.locality ? { locality: req.query.locality } : {}
  const rows = await db.collection(col).find(filter)
  ok(res, asFC(rows.map((r) => asFeature(r.geometry, { ...r, geometry: undefined, layer: req.params.layer }))))
})
