// Phase 3 — AI building-footprint extraction API (additive).
//
// Every response makes the non-official nature explicit: source 'AI_DEMO',
// ulpinStatus 'DEMO_NOT_OFFICIAL'. AI results live in their own `aiBuildings`
// collection and never touch the existing `buildings` records.

import multer from 'multer'
import { db } from '../store/index.js'
import { env } from '../config/env.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'
import { inferBuildings, validateUpload, UploadValidationError, AI_BUILDINGS_DISCLAIMER } from '../services/aiBuildings/index.js'

// in-memory upload, hard size cap enforced by multer + re-checked in validateUpload
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.aiMaxUploadMb * 1024 * 1024, files: 1 },
}).single('image')

const REVIEW_STATES = ['REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION']

const publicDoc = (d) => {
  const { _id, ...rest } = d || {}
  return rest
}

export const inferAiBuildings = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No image uploaded (multipart field "image").')
  try {
    validateUpload({ buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype })
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
  const result = await inferBuildings({
    file: { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
    locality: req.body?.locality,
    user: req.user,
  })
  if (result.status === 'INVALID_INPUT') throw badRequest(result.reason || 'Unusable image.')
  ok(res, { ...result, buildings: (result.buildings || []).map(publicDoc) })
})

export const listAiBuildings = asyncHandler(async (req, res) => {
  const { parcel, job, locality, reviewStatus, confidenceLevel, limit } = req.query
  const filter = {}
  if (parcel) filter.parentParcelId = parcel
  if (job) filter.jobId = job
  if (locality) filter.locality = locality
  if (reviewStatus) filter.reviewStatus = reviewStatus
  if (confidenceLevel) filter.confidenceLevel = confidenceLevel
  const rows = await db.collection('aiBuildings').find(filter, {
    sort: { timestamp: -1 }, limit: limit ? Number(limit) : undefined,
  })
  list(res, rows.map(publicDoc), { total: await db.collection('aiBuildings').count(filter), disclaimer: AI_BUILDINGS_DISCLAIMER })
})

export const getAiBuilding = asyncHandler(async (req, res) => {
  const row = await db.collection('aiBuildings').findOne({ aiBuildingId: req.params.id })
  if (!row) throw notFoundError(`No AI building ${req.params.id}`)
  ok(res, publicDoc(row))
})

export const getAiJob = asyncHandler(async (req, res) => {
  const row = await db.collection('aiJobs').findOne({ jobId: req.params.id })
  if (!row) throw notFoundError(`No AI job ${req.params.id}`)
  ok(res, publicDoc(row))
})

export const listAiJobs = asyncHandler(async (req, res) => {
  const rows = await db.collection('aiJobs').find({}, { sort: { createdAt: -1 }, limit: 50 })
  list(res, rows.map(publicDoc))
})

export const reviewAiBuilding = asyncHandler(async (req, res) => {
  const { id } = req.params
  const next = String(req.body?.reviewStatus || '').toUpperCase()
  if (!REVIEW_STATES.includes(next)) throw badRequest(`reviewStatus must be one of ${REVIEW_STATES.join(', ')}`)
  const row = await db.collection('aiBuildings').findOne({ aiBuildingId: id })
  if (!row) throw notFoundError(`No AI building ${id}`)
  const updated = await db.collection('aiBuildings').updateOne(
    { aiBuildingId: id },
    { reviewStatus: next, reviewedBy: req.user?.username || null, reviewedAt: new Date().toISOString() },
  )
  await recordAudit({
    user: req.user?.username,
    action: 'AI_BUILDING_REVIEWED',
    entityType: 'AiBuilding',
    entityId: id,
    before: { reviewStatus: row.reviewStatus },
    after: { reviewStatus: next },
    ip: req.ip,
  })
  // A review NEVER confers official/verified status — it is a prototype
  // decision-support flag only.
  ok(res, { ...publicDoc(updated), note: 'Prototype review flag only — confers no official or ownership status.' })
})

const asFeature = (geometry, properties) => ({ type: 'Feature', geometry, properties })

export const gisAiBuildings = asyncHandler(async (req, res) => {
  const filter = { georeferenced: true }
  if (req.query.locality) filter.locality = req.query.locality
  const rows = await db.collection('aiBuildings').find(filter)
  ok(res, {
    type: 'FeatureCollection',
    disclaimer: AI_BUILDINGS_DISCLAIMER,
    features: rows
      .filter((b) => b.geometry)
      .map((b) => asFeature(b.geometry, {
        aiBuildingId: b.aiBuildingId,
        kind: 'ai-building',
        source: 'AI_DEMO',
        model: b.model,
        modelVersion: b.modelVersion,
        confidence: b.confidence,
        confidenceLevel: b.confidenceLevel,
        geometryStatus: b.geometryStatus,
        parcelStatus: b.parcelStatus,
        parentParcelId: b.parentParcelId,
        parentULPIN: b.parentULPIN,
        ulpinStatus: b.ulpinStatus,
        reviewStatus: b.reviewStatus,
        reviewRequired: b.reviewRequired,
        height: null,
        heightStatus: b.heightStatus,
        estimated: true,
        locality: b.locality,
        layer: 'ai-buildings',
      })),
  })
})
