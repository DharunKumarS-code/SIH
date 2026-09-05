// Phase 4 — AI floor-plan & apartment/unit segmentation API (additive).
//
// Every response makes the non-official nature explicit: source 'AI_DEMO',
// dataClassification 'DEMO_RESEARCH_DATA' (dataset: CubiCasa5K), ulpinStatus
// 'DEMO_NOT_OFFICIAL'. AI floor-plan results live in their own collections
// (aiFloorPlans / aiRooms / aiFloorUnits) and never touch the existing
// buildings / floors / propertyUnits records.

import multer from 'multer'
import { db } from '../store/index.js'
import { env } from '../config/env.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'
import {
  inferFloorPlan,
  validateUpload,
  UploadValidationError,
  AI_FLOORPLANS_DISCLAIMER,
} from '../services/aiFloorPlans/index.js'

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.aiMaxUploadMb * 1024 * 1024, files: 1 },
}).single('image')

const REVIEW_STATES = ['REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION']

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

export const inferAiFloorPlan = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No image uploaded (multipart field "image").')
  try {
    validateUpload({ buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype })
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
  const result = await inferFloorPlan({
    file: { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
    user: req.user,
    buildingId: req.body?.buildingId || undefined,
    floorId: req.body?.floorId || undefined,
    parcelId: req.body?.parcelId || undefined,
    scaleMPerPx: req.body?.scaleMPerPx || undefined,
  })
  if (result.status === 'INVALID_INPUT') throw badRequest(result.reason || 'Unusable image.')
  ok(res, {
    ...result,
    rooms: (result.rooms || []).map(publicDoc),
    units: (result.units || []).map(publicDoc),
  })
})

export const listAiFloorPlans = asyncHandler(async (req, res) => {
  const { building, floor, job, locality, reviewStatus, limit } = req.query
  const filter = {}
  if (building) filter.buildingId = building
  if (floor) filter.floorId = floor
  if (job) filter.jobId = job
  if (locality) filter.locality = locality
  if (reviewStatus) filter.reviewStatus = reviewStatus
  const rows = await db.collection('aiFloorPlans').find(filter, {
    sort: { timestamp: -1 }, limit: limit ? Number(limit) : undefined,
  })
  list(res, rows.map(publicDoc), {
    total: await db.collection('aiFloorPlans').count(filter),
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  })
})

export const getAiFloorPlan = asyncHandler(async (req, res) => {
  const row = await db.collection('aiFloorPlans').findOne({ floorPlanId: req.params.id })
  if (!row) throw notFoundError(`No AI floor plan ${req.params.id}`)
  ok(res, publicDoc(row))
})

export const getAiFloorPlanRooms = asyncHandler(async (req, res) => {
  const plan = await db.collection('aiFloorPlans').findOne({ floorPlanId: req.params.id })
  if (!plan) throw notFoundError(`No AI floor plan ${req.params.id}`)
  const rows = await db.collection('aiRooms').find({ floorPlanId: req.params.id })
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: AI_FLOORPLANS_DISCLAIMER })
})

export const getAiFloorPlanUnits = asyncHandler(async (req, res) => {
  const plan = await db.collection('aiFloorPlans').findOne({ floorPlanId: req.params.id })
  if (!plan) throw notFoundError(`No AI floor plan ${req.params.id}`)
  const rows = await db.collection('aiFloorUnits').find({ floorPlanId: req.params.id })
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: AI_FLOORPLANS_DISCLAIMER })
})

export const getAiFloorPlanValidation = asyncHandler(async (req, res) => {
  const plan = await db.collection('aiFloorPlans').findOne({ floorPlanId: req.params.id })
  if (!plan) throw notFoundError(`No AI floor plan ${req.params.id}`)
  ok(res, {
    floorPlanId: plan.floorPlanId,
    validation: plan.validation || { status: 'VALID', counts: {}, issues: [] },
    summary: plan.summary || {},
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  })
})

export const getAiFloorPlanStatus = asyncHandler(async (req, res) => {
  const plan = await db.collection('aiFloorPlans').findOne({ floorPlanId: req.params.id })
  if (!plan) throw notFoundError(`No AI floor plan ${req.params.id}`)
  const job = plan.jobId ? await db.collection('aiJobs').findOne({ jobId: plan.jobId }) : null
  ok(res, {
    floorPlanId: plan.floorPlanId,
    jobId: plan.jobId,
    jobStatus: job?.status || null,
    reviewStatus: plan.reviewStatus,
    georeferenced: plan.georeferenced,
    geoStatus: plan.geoStatus,
    summary: plan.summary || {},
    source: 'AI_DEMO',
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  })
})

export const getAiFloorUnit = asyncHandler(async (req, res) => {
  const row = await db.collection('aiFloorUnits').findOne({ aiFloorUnitId: req.params.id })
  if (!row) throw notFoundError(`No AI floor unit ${req.params.id}`)
  const rooms = await db.collection('aiRooms').find({ roomId: { $in: row.rooms || [] } })
  ok(res, { ...publicDoc(row), roomDetails: rooms.map(publicDoc) })
})

const setReview = (collection, key) => asyncHandler(async (req, res) => {
  const id = req.params.id
  const next = String(req.body?.reviewStatus || '').toUpperCase()
  if (!REVIEW_STATES.includes(next)) throw badRequest(`reviewStatus must be one of ${REVIEW_STATES.join(', ')}`)
  const row = await db.collection(collection).findOne({ [key]: id })
  if (!row) throw notFoundError(`No ${collection} ${id}`)
  const updated = await db.collection(collection).updateOne(
    { [key]: id },
    { reviewStatus: next, reviewedBy: req.user?.username || null, reviewedAt: new Date().toISOString() },
  )
  await recordAudit({
    user: req.user?.username,
    action: collection === 'aiFloorPlans' ? 'AI_FLOORPLAN_REVIEWED' : 'AI_FLOOR_UNIT_REVIEWED',
    entityType: collection === 'aiFloorPlans' ? 'AiFloorPlan' : 'AiFloorUnit',
    entityId: id,
    before: { reviewStatus: row.reviewStatus },
    after: { reviewStatus: next },
    ip: req.ip,
  })
  ok(res, {
    ...publicDoc(updated),
    note: 'Prototype review flag only — confers no official, cadastral or ownership status.',
  })
})

export const reviewAiFloorPlan = setReview('aiFloorPlans', 'floorPlanId')
export const reviewAiFloorUnit = setReview('aiFloorUnits', 'aiFloorUnitId')

const asFeature = (geometry, properties) => ({ type: 'Feature', geometry, properties })

// GeoJSON FeatureCollection of GEOREFERENCED AI floor units for the Cesium layer.
export const gisAiFloorUnits = asyncHandler(async (req, res) => {
  const filter = { georeferenced: true }
  if (req.query.locality) filter.locality = req.query.locality
  if (req.query.building) filter.buildingId = req.query.building
  if (req.query.floor) filter.floorId = req.query.floor
  const rows = await db.collection('aiFloorUnits').find(filter)
  ok(res, {
    type: 'FeatureCollection',
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
    features: rows
      .filter((u) => u.geometry)
      .map((u) => asFeature(u.geometry, {
        aiFloorUnitId: u.aiFloorUnitId,
        localUnitId: u.localUnitId,
        kind: 'ai-floor-unit',
        source: 'AI_DEMO',
        dataClassification: u.dataClassification || 'DEMO_RESEARCH_DATA',
        dataset: u.dataset || 'CubiCasa5K',
        model: u.model,
        modelVersion: u.modelVersion,
        confidence: u.confidence,
        confidenceLevel: u.confidenceLevel,
        geometryStatus: u.geometryStatus,
        floorPlanId: u.floorPlanId,
        floorId: u.floorId,
        buildingId: u.buildingId,
        parentParcelId: u.parentParcelId,
        parentULPIN: u.parentULPIN,
        ulpinStatus: u.ulpinStatus,
        roomCount: (u.rooms || []).length,
        roomTypes: u.roomTypes || [],
        area: u.area,
        areaUnit: u.areaUnit,
        areaStatus: u.areaStatus,
        volume: u.volume || null,
        baseHeight: u.volume?.zmin ?? null,
        topHeight: u.volume?.zmax ?? null,
        heightStatus: u.heightStatus,
        estimated: true,
        reviewStatus: u.reviewStatus,
        reviewRequired: u.reviewRequired,
        locality: u.locality,
        layer: 'ai-floor-units',
      })),
  })
})
