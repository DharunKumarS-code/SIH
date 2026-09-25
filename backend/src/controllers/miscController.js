import { z } from 'zod'
import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError, badRequest } from '../utils/http.js'
import { dashboardStats, analyticsStats } from '../services/statsService.js'
import { runInference, aiStatus, AI_FEATURES } from '../services/aiService.js'
import { recordAudit } from '../services/auditService.js'
import { parseProtoPropertyId } from '../services/idService.js'
import { demoProvenance } from '../services/landData/index.js'
import { parseVolumeId, deriveVolumeId } from '../services/geometry3d/index.js'
import { searchIdentifiers } from '../services/identifier3d/index.js'

/* --------------------------------------------------------------- dashboard */
export const getDashboard = asyncHandler(async (_req, res) => ok(res, await dashboardStats()))
export const getAnalytics = asyncHandler(async (_req, res) => ok(res, await analyticsStats()))

/* ---------------------------------------------------------------- disputes */
export const listDisputes = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.status) filter.status = req.query.status
  if (req.query.ulpin) filter.ulpin = req.query.ulpin
  if (req.query.propertyId) filter.propertyId = req.query.propertyId
  list(res, await db.collection('disputes').find(filter, { sort: { filedOn: -1 } }))
})
export const getDispute = asyncHandler(async (req, res) => {
  const row = await db.collection('disputes').findOne({ disputeId: req.params.disputeId })
  if (!row) throw notFoundError()
  ok(res, row)
})

/* ---------------------------------------------------------------------- ai */
export const getAiStatus = asyncHandler(async (_req, res) => ok(res, await aiStatus()))
export const runAi = asyncHandler(async (req, res) => {
  const feature = req.params.feature
  if (!AI_FEATURES.some((f) => f.key === feature)) throw badRequest(`Unknown AI feature "${feature}"`)
  const result = await runInference(feature, req.body || {})
  await recordAudit({ user: req.user?.username, action: 'AI_INFERENCE', entityType: 'AiFeature', entityId: feature, ip: req.ip })
  ok(res, result)
})

/* ------------------------------------------------------ citizen services */
const WORKFLOW = [
  'Submitted',
  'Document Verification',
  'Parcel / Boundary Verification',
  'Technical / Zoning Verification',
  'Government Officer Review',
  'Approved',
]

export const serviceSchema = {
  body: z.object({
    type: z.string().min(3),
    ulpin: z.string().min(3),
    propertyId: z.string().optional(),
    note: z.string().max(500).optional(),
  }),
}

export const listServices = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.user?.role === 'Citizen') filter.raisedBy = req.user.username
  if (req.query.status) filter.status = req.query.status
  list(res, await db.collection('serviceRequests').find(filter, { sort: { submittedOn: -1 } }))
})

export const getService = asyncHandler(async (req, res) => {
  const row = await db.collection('serviceRequests').findOne({ requestId: req.params.requestId })
  if (!row) throw notFoundError()
  ok(res, { request: row, workflow: WORKFLOW })
})

export const createService = asyncHandler(async (req, res) => {
  const { type, ulpin, propertyId, note } = req.body
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw badRequest(`Unknown ULPIN ${ulpin}`)
  const requestId = `SRV-${Date.now().toString(36).toUpperCase()}`
  const now = new Date().toISOString()
  const row = {
    requestId,
    type,
    ulpin,
    propertyId: propertyId || null,
    raisedBy: req.user?.username || 'anonymous',
    status: 'Submitted',
    stage: 'Submitted',
    submittedOn: now,
    history: [{ stage: 'Submitted', at: now, by: req.user?.username || 'anonymous', note: note || 'Request created.' }],
    isDemo: true,
  }
  await db.collection('serviceRequests').create(row)
  await db.collection('notifications').create({
    notificationId: `NTF-${Date.now().toString(36)}`,
    forRole: 'Land Officer',
    kind: 'Approval Pending',
    message: `New service request ${requestId} (${type}) for ${ulpin}.`,
    entityRef: requestId,
    createdAt: now,
    read: false,
  })
  await recordAudit({ user: req.user?.username, action: 'SERVICE_REQUEST_CREATED', entityType: 'ServiceRequest', entityId: requestId, ip: req.ip })
  ok(res, { request: row })
})

export const advanceService = asyncHandler(async (req, res) => {
  const row = await db.collection('serviceRequests').findOne({ requestId: req.params.requestId })
  if (!row) throw notFoundError()
  const idx = WORKFLOW.indexOf(row.stage)
  const decision = req.body?.decision === 'reject' ? 'Rejected' : WORKFLOW[Math.min(idx + 1, WORKFLOW.length - 1)]
  const now = new Date().toISOString()
  const history = [...(row.history || []), { stage: decision, at: now, by: req.user?.username, note: req.body?.note || '' }]
  const updated = await db.collection('serviceRequests').updateOne(
    { requestId: row.requestId },
    { stage: decision, status: decision, history },
  )
  await recordAudit({ user: req.user?.username, action: 'SERVICE_REQUEST_ADVANCED', entityType: 'ServiceRequest', entityId: row.requestId, before: { stage: row.stage }, after: { stage: decision }, ip: req.ip })
  ok(res, { request: updated, workflow: WORKFLOW })
})

/* -------------------------------------------------------------- reports */
export const getReport = asyncHandler(async (req, res) => {
  const { kind, id } = req.query
  const now = new Date().toISOString()
  let title
  let sections = []
  if (kind === 'property') {
    const unit = await db.collection('propertyUnits').findOne({ propertyId: id })
    if (!unit) throw notFoundError()
    const tax = await db.collection('propertyTax').findOne({ propertyId: id })
    const reg = await db.collection('registrations').findOne({ propertyId: id })
    title = `Property Report — ${unit.propertyId}`
    sections = [
      { heading: 'Identification', rows: { 'Prototype 3D Property ID': unit.propertyId, 'Parent ULPIN': unit.ulpin, Building: unit.buildingName, Floor: unit.floorLabel, Unit: unit.unitId } },
      { heading: 'Unit', rows: { 'Carpet Area': `${unit.carpetAreaSqft} sq.ft`, 'Built-up Area': `${unit.builtUpAreaSqft} sq.ft`, Bedrooms: unit.bedrooms, Facing: unit.facing, Usage: unit.usage, Status: unit.status } },
      { heading: 'Owner (synthetic demo)', rows: { Name: unit.owner?.name, 'Ownership Type': unit.owner?.ownershipType, Share: `${unit.owner?.sharePct}%` } },
      { heading: 'Governance', rows: { Registration: reg?.docNumber || 'Not Available', 'Registration Status': reg?.status || '—', 'Tax Status': tax?.status || 'Not Available', 'Tax Due': tax ? `₹${tax.dueAmountRs}` : '—' } },
    ]
  } else if (kind === 'parcel') {
    const p = await db.collection('parcels').findOne({ ulpin: id })
    if (!p) throw notFoundError()
    const buildings = await db.collection('buildings').find({ ulpin: id })
    const units = await db.collection('propertyUnits').count({ ulpin: id })
    title = `Parcel Report — ${p.ulpin}`
    sections = [
      { heading: 'Parcel', rows: { ULPIN: p.ulpin, 'Parcel ID': p.parcelId, 'Survey No.': p.surveyNumber, Taluk: p.taluk, District: p.district, 'Area (sq.ft)': p.areaSqft, 'Land Use': p.landUse } },
      { heading: 'Status', rows: { Ownership: p.ownershipStatus, Registration: p.registrationStatus, Encumbrance: p.encumbranceStatus, 'Property Tax': p.propertyTaxStatus } },
      { heading: '3D Property', rows: { Buildings: buildings.length, 'Total Units': units } },
    ]
  } else if (kind === 'building') {
    const b = await db.collection('buildings').findOne({ buildingId: id })
    if (!b) throw notFoundError()
    const approval = await db.collection('buildingApprovals').findOne({ buildingId: id })
    title = `Building Report — ${b.name}`
    sections = [
      { heading: 'Building', rows: { 'Building ID': b.buildingId, Name: b.name, 'Parent ULPIN': b.ulpin, 'Floors (incl. ground)': b.totalFloors, Units: b.unitCount, 'Height (m)': b.heightM, Construction: b.constructionStatus } },
      { heading: 'Approval', rows: { 'Plan No.': approval?.planNumber, Authority: approval?.authority, 'Approved Floors': approval?.approvedFloors, Status: approval?.status } },
    ]
  } else {
    throw badRequest('kind must be one of property | parcel | building')
  }
  ok(res, { title, generatedAt: now, isDemo: true, disclaimer: 'Prototype report generated from synthetic demo data.', sections })
})

/* ---------------------------------------------------------- notifications */
export const listNotifications = asyncHandler(async (req, res) => {
  const role = req.user?.role
  const rows = await db.collection('notifications').find(
    role ? { $or: [{ forRole: role }, { forUser: req.user.username }] } : {},
    { sort: { createdAt: -1 } },
  )
  list(res, rows)
})
export const markNotificationRead = asyncHandler(async (req, res) => {
  const updated = await db.collection('notifications').updateOne({ notificationId: req.params.id }, { read: true })
  if (!updated) throw notFoundError()
  ok(res, updated)
})

/* --------------------------------------------------------------- admin */
export const listUsers = asyncHandler(async (_req, res) => {
  const rows = await db.collection('users').find({}, { projection: { passwordHash: 0, demoPassword: 0 } })
  list(res, rows)
})
export const listAudit = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.entityId) filter.entityId = req.query.entityId
  if (req.query.action) filter.action = req.query.action
  if (req.user?.role !== 'Administrator') filter.user = req.user.username
  list(res, await db.collection('auditLogs').find(filter, { sort: { at: -1 }, limit: 200 }))
})

/* --------------------------------------------------------------- system */
export const getSystemStatus = asyncHandler(async (_req, res) => {
  const s = db.status
  ok(res, {
    services: {
      'GIS Data': 'Connected (demo layers)',
      'Land Records': 'Demo Connected (mock adapter)',
      Registration: 'Demo Connected (mock adapter)',
      'Property Tax': 'Demo Connected (mock adapter)',
      '3D Engine': 'Active (client-side CesiumJS)',
      'AI Service': (await aiStatus()).mode === 'connected' ? 'Connected' : 'Demo Mode',
      Database: s.mongoConnected ? 'Connected (MongoDB)' : 'Demo dataset (no MongoDB)',
    },
    store: s,
    disclaimer:
      'No live government connectivity. Land Records / Registration / Property Tax are DEMO / MOCK integrations. Records are synthetic.',
  })
})

export const getDemoCredentials = asyncHandler(async (_req, res) => {
  const users = await db.collection('users').find({})
  ok(res, {
    note: 'Prototype demo accounts only.',
    accounts: users
      .filter((u) => u.demoPassword)
      .map((u) => ({ username: u.username, password: u.demoPassword, role: u.role })),
  })
})

/* ---------------------------------------------------------- global search */
export const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return ok(res, { query: q, results: [] })
  const rx = { $regex: q }
  const results = []

  const parsed = parseProtoPropertyId(q)
  if (parsed) {
    const unit = await db.collection('propertyUnits').findOne({ propertyId: q.toUpperCase() })
    if (unit) {
      results.push({
        kind: 'unit',
        title: unit.propertyId,
        subtitle: `${unit.buildingName} · ${unit.floorLabel} · ${unit.name}`,
        ref: { propertyId: unit.propertyId, buildingId: unit.buildingId, floorNumber: unit.floorNumber, ulpin: unit.ulpin },
        centroid: unit.centroid,
      })
    }
  }

  // Phase 2 — prototype Volume ID search (V<ff><nn> unit, VF<ff> floor). Resolves
  // to the existing unit/floor navigation; not an official identifier.
  const volParsed = parseVolumeId(q)
  if (volParsed?.kind === 'unit') {
    const cand = await db.collection('propertyUnits').find({ floorNumber: volParsed.floorNumber }, { limit: 40 })
    for (const u of cand) {
      if (deriveVolumeId('unit', u) !== q.toUpperCase()) continue
      results.push({
        kind: 'unit',
        title: u.propertyId,
        subtitle: `Volume ${q.toUpperCase()} · ${u.buildingName} · ${u.floorLabel}`,
        volumeId: q.toUpperCase(),
        ref: { propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin },
        centroid: u.centroid,
      })
    }
  } else if (volParsed?.kind === 'floor') {
    const cand = await db.collection('floors').find({ floorNumber: volParsed.floorNumber }, { limit: 8 })
    for (const f of cand) {
      results.push({
        kind: 'floor',
        title: f.floorId,
        subtitle: `Volume ${q.toUpperCase()} · ${f.label}`,
        volumeId: q.toUpperCase(),
        ref: { buildingId: f.buildingId, floorNumber: f.floorNumber, ulpin: f.ulpin },
        centroid: f.centroid,
      })
    }
  }

  // Phase 8 — underground infrastructure (by infrastructureId / type / owner
  // authority / status / source). Selecting a result focuses the object in the
  // existing Chennai Cesium viewer.
  const infra = await db.collection('undergroundInfrastructure').find({
    $or: [
      { infrastructureId: rx }, { type: rx }, { subtype: rx },
      { ownerAuthority: rx }, { status: rx }, { source: rx }, { parentParcel: rx },
    ],
  }, { limit: 6 })
  for (const inf of infra) {
    results.push({
      kind: 'infrastructure',
      title: inf.infrastructureId,
      subtitle: `${inf.type}${inf.subtype ? ` · ${inf.subtype}` : ''} · ${inf.ownerAuthority || inf.source}`,
      verification: inf.verificationStatus,
      ref: { infrastructureId: inf.infrastructureId, locality: inf.locality },
      centroid: null,
    })
  }

  // Phase 9 — Proposed 3D Property Identifier (canonical 3DPR:... string, or any
  // hierarchy component). Selecting a result focuses the referenced unit/volume
  // in the SAME Chennai Cesium viewer (reuses the existing unit selection).
  const idRows = await searchIdentifiers(q, { limit: 6 })
  for (const r of idRows) {
    results.push({
      kind: 'identifier',
      title: r.canonicalIdentifier,
      subtitle: `Proposed 3D Property Identifier · ULPIN ${r.officialULPIN || 'NOT AVAILABLE'} · ${r.geometryVersion} · ${r.status}`,
      verification: r.verificationStatus,
      ref: r.propertyId
        ? { propertyId: r.propertyId, buildingId: r.buildingId, floorNumber: Number(String(r.floorSegment || 'F00').slice(1)), ulpin: r.officialULPIN, identifierId: r.identifierId, locality: r.locality }
        : { identifierId: r.identifierId, locality: r.locality },
      centroid: null,
    })
  }

  // TNGIS / Tamil Nilam — cached public-source parcels (by district / taluk /
  // village name, LGD code, survey number, or source record id). Selecting a
  // result focuses the parcel in the SAME Chennai Cesium viewer. Protected
  // ULPIN search is deliberately NOT offered (public source has no ULPIN).
  const tngisRows = await db.collection('tngisParcels').find({
    $or: [
      { sourceRecordId: rx }, { surveyNumber: rx },
      { districtName: rx }, { talukName: rx }, { villageName: rx },
      { lgdDistrictCode: rx }, { lgdTalukCode: rx }, { lgdVillageCode: rx },
    ],
  }, { limit: 6 })
  for (const t of tngisRows) {
    results.push({
      kind: 'tngis-parcel',
      title: `Survey ${t.surveyNumber}${t.subDivision ? `/${t.subDivision}` : ''} · ${t.villageName || t.villageCode}`,
      subtitle: `TNGIS OFFICIAL SOURCE · ${t.talukName || t.talukCode}, ${t.districtName || t.districtCode} · LGD ${t.lgdVillageCode || '—'} · ULPIN unavailable`,
      verification: t.verificationStatus,
      ref: { sourceRecordId: t.sourceRecordId, locality: t.locality },
      centroid: t.centroid ? { type: 'Point', coordinates: [t.centroid.longitude, t.centroid.latitude] } : null,
    })
  }

  const [parcels, buildings, floors, units, owners] = await Promise.all([
    db.collection('parcels').find({
      $or: [
        { ulpin: rx }, { parcelId: rx }, { surveyNumber: rx }, { subDivision: rx }, { subdivisionNumber: rx },
        { village: rx }, { ward: rx }, { district: rx }, { taluk: rx }, { locality: rx },
      ],
    }, { limit: 6 }),
    db.collection('buildings').find({ $or: [{ buildingId: rx }, { name: rx }, { shortName: rx }, { threeDUlpin: rx }] }, { limit: 6 }),
    db.collection('floors').find({ $or: [{ floorId: rx }] }, { limit: 6 }),
    db.collection('propertyUnits').find({ $or: [{ propertyId: rx }, { apartmentNumber: rx }, { unitId: rx }, { threeDUlpin: rx }] }, { limit: 8 }),
    db.collection('propertyUnits').find({ 'owner.name': rx }, { limit: 8 }),
  ])

  for (const p of parcels) {
    const v = demoProvenance(p).verificationStatus
    results.push({ kind: 'parcel', title: p.ulpin, subtitle: `${p.parcelId} · ${p.landUse}`, verification: v, ref: { ulpin: p.ulpin }, centroid: p.centroid })
  }
  for (const b of buildings) results.push({ kind: 'building', title: b.name, subtitle: `${b.buildingId} · ${b.unitCount} units`, ref: { buildingId: b.buildingId, ulpin: b.ulpin }, centroid: b.centroid })
  for (const f of floors) results.push({ kind: 'floor', title: f.floorId, subtitle: `${f.label} · ${f.unitCount ?? '—'} units`, ref: { buildingId: f.buildingId, floorNumber: f.floorNumber, ulpin: f.ulpin }, centroid: f.centroid })
  for (const u of units) if (!results.some((r) => r.ref?.propertyId === u.propertyId)) results.push({ kind: 'unit', title: u.propertyId, subtitle: `${u.buildingName} · ${u.name}`, ref: { propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin }, centroid: u.centroid })
  for (const u of owners) results.push({ kind: 'owner', title: u.owner.name, subtitle: `Owner · ${u.propertyId}`, ref: { propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin }, centroid: u.centroid })

  ok(res, { query: q, count: results.length, results: results.slice(0, 24) })
})
