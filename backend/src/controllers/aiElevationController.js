// Phase 5 — elevation / LiDAR / point-cloud / DEM / DSM API (additive).
//
// Every response makes the non-official nature explicit: source
// 'ELEVATION_DEMO' (or RESEARCH_DATA / TEST_FIXTURE / USER_SUPPLIED),
// isOfficial: false. Results live in their own `elevationDatasets` /
// `buildingHeights` collections; the existing `buildings` collection is only
// ever touched by the explicit, reversible review/accept action.

import multer from 'multer'
import { db } from '../store/index.js'
import { env } from '../config/env.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { recordAudit } from '../services/auditService.js'
import {
  elevationConfig, validateDataset, processElevation,
  UploadValidationError, AI_ELEVATION_DISCLAIMER,
} from '../services/aiElevation/index.js'
import { applyElevationOverride, revertElevationOverride } from '../services/aiElevation/heightIntegration.js'

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.aiMaxElevationUploadMb * 1024 * 1024, files: 1 },
}).single('file')

export const uploadProcessFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.aiMaxElevationUploadMb * 1024 * 1024, files: 3 },
}).fields([{ name: 'dem', maxCount: 1 }, { name: 'dsm', maxCount: 1 }, { name: 'pointcloud', maxCount: 1 }])

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

const asMulterFile = (f) => (f ? { buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype } : null)

export const getConfig = asyncHandler(async (req, res) => {
  const cfg = await elevationConfig()
  ok(res, cfg || { pipeline: [], disclaimer: AI_ELEVATION_DISCLAIMER, note: 'ai-service not configured or unreachable.' })
})

export const uploadDataset = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (multipart field "file").')
  try {
    const result = await validateDataset({
      file: asMulterFile(req.file),
      datasetType: req.body?.datasetType,
      locality: req.body?.locality,
      sourceLabel: req.body?.sourceLabel,
      datasetName: req.body?.datasetName,
      user: req.user,
    })
    if (result.invalidInput) throw badRequest(result.error || 'Invalid elevation dataset.')
    ok(res, publicDoc(result))
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

export const processDataset = asyncHandler(async (req, res) => {
  const files = req.files || {}
  const dem = asMulterFile(files.dem?.[0])
  const dsm = asMulterFile(files.dsm?.[0])
  const pointcloud = asMulterFile(files.pointcloud?.[0])
  const buildingIds = req.body?.buildingIds
    ? String(req.body.buildingIds).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined
  try {
    const result = await processElevation({
      dem, dsm, pointcloud,
      buildingIds, locality: req.body?.locality,
      bufferM: req.body?.bufferM, sourceLabel: req.body?.sourceLabel, datasetName: req.body?.datasetName,
      verticalDatumDem: req.body?.verticalDatumDem, verticalDatumDsm: req.body?.verticalDatumDsm,
      user: req.user,
    })
    if (result.status === 'INVALID_INPUT') throw badRequest(result.reason || 'Invalid elevation input.')
    ok(res, { ...result, buildings: (result.buildings || []).map(publicDoc) })
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

export const listDatasets = asyncHandler(async (req, res) => {
  const { locality, datasetType, status, limit } = req.query
  const filter = {}
  if (locality) filter.locality = locality
  if (datasetType) filter.datasetType = String(datasetType).toUpperCase()
  if (status) filter.status = status
  const rows = await db.collection('elevationDatasets').find(filter, {
    sort: { createdAt: -1 }, limit: limit ? Number(limit) : undefined,
  })
  list(res, rows.map(publicDoc), { total: await db.collection('elevationDatasets').count(filter), disclaimer: AI_ELEVATION_DISCLAIMER })
})

export const getDataset = asyncHandler(async (req, res) => {
  const row = await db.collection('elevationDatasets').findOne({ datasetId: req.params.id })
  if (!row) throw notFoundError(`No elevation dataset ${req.params.id}`)
  ok(res, publicDoc(row))
})

export const getDatasetStatus = asyncHandler(async (req, res) => {
  const row = await db.collection('elevationDatasets').findOne({ datasetId: req.params.id })
  if (!row) throw notFoundError(`No elevation dataset ${req.params.id}`)
  ok(res, {
    datasetId: row.datasetId, status: row.status, validationStatus: row.validationStatus || null,
    error: row.error || null, source: row.source, disclaimer: AI_ELEVATION_DISCLAIMER,
  })
})

// Latest buildingHeights result for a building, regardless of review state.
async function latestHeight(buildingId) {
  const rows = await db.collection('buildingHeights').find({ buildingId }, { sort: { timestamp: -1 }, limit: 1 })
  return rows[0] || null
}

export const getBuildingHeight = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) throw notFoundError(`No building ${buildingId}`)
  const row = await latestHeight(buildingId)
  if (!row) {
    return ok(res, {
      buildingId, dataAvailability: 'UNAVAILABLE', reason: 'No elevation dataset has been processed for this building yet.',
      existingHeightM: building.heightM ?? null,
      existingHeightSource: building.elevationOverrideActive ? building.elevationSource : 'DEMO_ESTIMATED',
      disclaimer: AI_ELEVATION_DISCLAIMER,
    })
  }
  ok(res, { ...publicDoc(row), dataAvailability: 'AVAILABLE' })
})

export const getBuildingQuality = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const row = await latestHeight(buildingId)
  if (!row) throw notFoundError(`No elevation height result for building ${buildingId}`)
  ok(res, {
    buildingId,
    qualityStatus: row.qualityStatus,
    qualityIssues: row.qualityIssues || [],
    confidenceLevel: row.confidenceLevel,
    confidenceScore: row.confidenceScore,
    crsStatus: row.crsStatus,
    disclaimer: AI_ELEVATION_DISCLAIMER,
  })
})

const REVIEW_ACTIONS = ['ACCEPT', 'REJECT']

// Accept -> apply the elevation-derived height onto the building/floors/units
// (reversible). Reject -> leave the existing geometry untouched, just record
// the decision. Never automatic — requires change-detection:review.
export const reviewBuildingHeight = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const action = String(req.body?.action || '').toUpperCase()
  if (!REVIEW_ACTIONS.includes(action)) throw badRequest(`action must be one of ${REVIEW_ACTIONS.join(', ')}`)
  const row = await latestHeight(buildingId)
  if (!row) throw notFoundError(`No elevation height result for building ${buildingId}`)

  if (action === 'ACCEPT') {
    if (row.qualityStatus === 'ERROR') {
      throw badRequest('Cannot accept an elevation height result with qualityStatus ERROR — resolve the underlying issue first.')
    }
    const updated = await applyElevationOverride(buildingId, row, req.user, req.ip)
    if (!updated) throw badRequest('Could not apply this elevation result (missing ground/height value, or building has no positive existing height to rescale from).')
    await db.collection('buildingHeights').updateOne({ buildingHeightId: row.buildingHeightId }, {
      reviewStatus: 'ACCEPTED', appliedToBuilding: true, reviewedBy: req.user?.username || null, reviewedAt: new Date().toISOString(),
    })
    return ok(res, { buildingId, action, building: updated, note: 'Elevation-derived height applied. Use action=REJECT (any later review) or the revert endpoint to undo.' })
  }

  const updated = await db.collection('buildingHeights').updateOne({ buildingHeightId: row.buildingHeightId }, {
    reviewStatus: 'REJECTED', reviewedBy: req.user?.username || null, reviewedAt: new Date().toISOString(),
  })
  ok(res, { buildingId, action, buildingHeight: publicDoc(updated), note: 'Existing building geometry retained unchanged.' })
})

// Explicit, separate revert — restores the exact pre-override geometry.
export const revertBuildingHeight = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) throw notFoundError(`No building ${buildingId}`)
  if (!building.elevationOverrideActive) throw badRequest('This building has no active elevation override to revert.')
  const updated = await revertElevationOverride(buildingId, req.user, req.ip)
  ok(res, { buildingId, building: updated })
})

export const getCoverage = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.locality) filter.locality = req.query.locality
  const rows = await db.collection('elevationDatasets').find(filter, { sort: { createdAt: -1 } })
  const byLocality = {}
  for (const r of rows) {
    const key = r.locality || 'unknown'
    byLocality[key] ||= { locality: key, datasets: 0, validated: 0, types: {} }
    byLocality[key].datasets += 1
    if (r.status === 'VALIDATED' || r.status === 'PROCESSED') byLocality[key].validated += 1
    byLocality[key].types[r.datasetType] = (byLocality[key].types[r.datasetType] || 0) + 1
  }
  ok(res, { coverage: Object.values(byLocality), disclaimer: AI_ELEVATION_DISCLAIMER })
})
