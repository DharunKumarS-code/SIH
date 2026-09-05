// Phase 6 — GNSS/CORS high-precision spatial control API (additive).
//
// Every response makes the non-official nature explicit (isOfficial: false,
// GNSS_DISCLAIMER). Control points live in their own `gnssControlPoints`
// collection; the existing `parcels` collection is only ever touched by the
// explicit, reviewer-gated geometry-proposal accept action.

import multer from 'multer'
import { db } from '../store/index.js'
import { env } from '../config/env.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import {
  UploadValidationError, validateUpload, validateControlPoints, importControlPoints,
  gnssPipelineConfig, elevationResidualForControlPoint, AI_GNSS_DISCLAIMER,
} from '../services/gnss/index.js'
import { transformPoints } from '../services/gnss/crsClient.js'
import { verifyParcelBoundary } from '../services/gnss/boundary.js'
import { createProposal, getProposal, listProposals, reviewProposal } from '../services/gnss/reviewProposals.js'
import { GNSS_CONFIG } from '../services/gnss/config.js'

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.gnssMaxUploadMb * 1024 * 1024, files: 1 },
}).single('file')

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

function parseFieldMap(raw) {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}

const formatFromReq = (req) =>
  String(req.body?.format || (req.file?.originalname || '').split('.').pop() || '').toLowerCase()

export const getConfig = asyncHandler(async (req, res) => {
  const cfg = await gnssPipelineConfig()
  ok(res, cfg)
})

export const validateUpload_ = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (multipart field "file").')
  try {
    validateUpload(req.file, { maxMb: env.gnssMaxUploadMb })
    const result = await validateControlPoints({
      text: req.file.buffer.toString('utf-8'),
      format: formatFromReq(req),
      fieldMap: parseFieldMap(req.body?.fieldMap),
      locality: req.body?.locality,
    })
    ok(res, result)
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

export const importUpload = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (multipart field "file").')
  try {
    validateUpload(req.file, { maxMb: env.gnssMaxUploadMb })
    const result = await importControlPoints({
      text: req.file.buffer.toString('utf-8'),
      format: formatFromReq(req),
      fieldMap: parseFieldMap(req.body?.fieldMap),
      locality: req.body?.locality,
      sourceLabel: req.body?.sourceLabel,
      provenanceNote: req.body?.provenanceNote,
      user: req.user,
    })
    ok(res, { ...result, controlPoints: result.controlPoints.map(publicDoc) })
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

// GET /api/gis/gnss-control-points — GeoJSON for the existing Cesium viewer's
// optional, OFF-by-default "GNSS/CORS Control Points" layer. Only points that
// resolved to a usable WGS84 coordinate are rendered — a point whose CRS
// transform failed is never placed on the map with a guessed position.
export const gisGnssControlPoints = asyncHandler(async (req, res) => {
  const { locality } = req.query
  const filter = {}
  if (locality) filter.locality = locality
  const rows = await db.collection('gnssControlPoints').find(filter, { sort: { createdAt: -1 } })
  const features = rows
    .map((r) => {
      const lon = r.resolvedLongitude ?? (r.crsStatus === 'MATCHED' || r.crsStatus === 'UNKNOWN' ? r.longitude : null)
      const lat = r.resolvedLatitude ?? (r.crsStatus === 'MATCHED' || r.crsStatus === 'UNKNOWN' ? r.latitude : null)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          controlPointId: r.controlPointId,
          height: r.height,
          accuracy: r.accuracy,
          accuracyStatus: r.accuracyStatus,
          coordinateReferenceSystem: r.coordinateReferenceSystem,
          crsStatus: r.crsStatus,
          timestamp: r.timestamp,
          source: r.source,
          surveyMethod: r.surveyMethod,
          validationStatus: r.validationStatus,
          parcelStatus: r.parcelStatus,
          parentULPIN: r.parentULPIN,
          verificationStatus: r.verificationStatus,
          isOfficial: false,
        },
      }
    })
    .filter(Boolean)
  ok(res, { type: 'FeatureCollection', features, disclaimer: AI_GNSS_DISCLAIMER })
})

export const listControlPoints = asyncHandler(async (req, res) => {
  const { locality, ulpin, parcelId, validationStatus, parcelStatus, source, limit } = req.query
  const filter = {}
  if (locality) filter.locality = locality
  if (ulpin) filter.parentULPIN = ulpin
  if (parcelId) filter.parentParcelId = parcelId
  if (validationStatus) filter.validationStatus = validationStatus
  if (parcelStatus) filter.parcelStatus = parcelStatus
  if (source) filter.source = source
  const rows = await db.collection('gnssControlPoints').find(filter, {
    sort: { createdAt: -1 }, limit: limit ? Number(limit) : undefined,
  })
  list(res, rows.map(publicDoc), { total: await db.collection('gnssControlPoints').count(filter), disclaimer: AI_GNSS_DISCLAIMER })
})

export const getControlPoint = asyncHandler(async (req, res) => {
  const row = await db.collection('gnssControlPoints').findOne({ controlPointId: req.params.id })
  if (!row) throw notFoundError(`No GNSS control point ${req.params.id}`)
  ok(res, publicDoc(row))
})

export const getControlPointValidation = asyncHandler(async (req, res) => {
  const row = await db.collection('gnssControlPoints').findOne({ controlPointId: req.params.id })
  if (!row) throw notFoundError(`No GNSS control point ${req.params.id}`)
  ok(res, {
    controlPointId: row.controlPointId,
    validationStatus: row.validationStatus,
    validationIssues: row.validationIssues || [],
    crsStatus: row.crsStatus,
    accuracy: row.accuracy,
    accuracyStatus: row.accuracyStatus,
    disclaimer: AI_GNSS_DISCLAIMER,
  })
})

export const getControlPointElevationResidual = asyncHandler(async (req, res) => {
  const row = await db.collection('gnssControlPoints').findOne({ controlPointId: req.params.id })
  if (!row) throw notFoundError(`No GNSS control point ${req.params.id}`)
  const residual = await elevationResidualForControlPoint(row)
  ok(res, { controlPointId: row.controlPointId, ...residual, disclaimer: AI_GNSS_DISCLAIMER })
})

export const listParcelControlPoints = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const rows = await db.collection('gnssControlPoints').find({ parentULPIN: ulpin }, { sort: { createdAt: -1 } })
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: AI_GNSS_DISCLAIMER })
})

export const getParcelBoundaryVerification = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No parcel ${ulpin}`)
  const points = await db.collection('gnssControlPoints').find({
    parentULPIN: ulpin,
    parcelStatus: { $in: ['MATCHED', 'REVIEW_REQUIRED'] },
  })
  const result = verifyParcelBoundary(parcel, points)
  ok(res, { ...result, disclaimer: AI_GNSS_DISCLAIMER })
})

export const runBoundaryAnalysis = asyncHandler(async (req, res) => {
  const { ulpin, parcelId } = req.body || {}
  const parcel = await db.collection('parcels').findOne(ulpin ? { ulpin } : { parcelId })
  if (!parcel) throw badRequest('No parcel found for the given ulpin/parcelId.')
  const points = await db.collection('gnssControlPoints').find({
    parentULPIN: parcel.ulpin,
    parcelStatus: { $in: ['MATCHED', 'REVIEW_REQUIRED'] },
  })
  const result = verifyParcelBoundary(parcel, points)
  const doc = {
    boundaryVerificationId: `GNSSBV-${Date.now().toString(36).toUpperCase()}`,
    parcelId: parcel.parcelId,
    ulpin: parcel.ulpin,
    ...result,
    requestedBy: req.user?.username || null,
    timestamp: new Date().toISOString(),
    isDemo: true,
    disclaimer: AI_GNSS_DISCLAIMER,
  }
  await db.collection('boundaryVerification').create(doc)
  ok(res, publicDoc(doc))
})

export const transform = asyncHandler(async (req, res) => {
  const { points, sourceCRS, targetCRS } = req.body || {}
  if (!Array.isArray(points) || !points.length) throw badRequest('points must be a non-empty array of {x,y}.')
  if (points.length > GNSS_CONFIG.candidateRadiusFactor * 1000) throw badRequest('Too many points for a single transform request.')
  const result = await transformPoints(points, sourceCRS, targetCRS || 'EPSG:4326')
  ok(res, { ...result, disclaimer: AI_GNSS_DISCLAIMER })
})

const CP_REVIEW_ACTIONS = ['ACCEPTED', 'REJECTED']

// A lightweight, data-level review — marks a REVIEW_REQUIRED control point as
// reviewed. This never touches parcel geometry (see proposals below for that).
export const reviewControlPoint = asyncHandler(async (req, res) => {
  const { controlPointId, action } = req.body || {}
  const status = String(action || '').toUpperCase()
  if (!controlPointId) throw badRequest('controlPointId is required.')
  if (!CP_REVIEW_ACTIONS.includes(status)) throw badRequest(`action must be one of ${CP_REVIEW_ACTIONS.join(', ')}`)
  const row = await db.collection('gnssControlPoints').findOne({ controlPointId })
  if (!row) throw notFoundError(`No GNSS control point ${controlPointId}`)
  const updated = await db.collection('gnssControlPoints').updateOne({ controlPointId }, {
    verificationStatus: status,
    reviewedBy: req.user?.username || null,
    reviewedAt: new Date().toISOString(),
  })
  ok(res, publicDoc(updated))
})

export const createGeometryProposal = asyncHandler(async (req, res) => {
  const { ulpin, parcelId, proposedGeometry, controlPointIds, deviations, reason } = req.body || {}
  if (!ulpin && !parcelId) throw badRequest('ulpin or parcelId is required.')
  try {
    const doc = await createProposal({ parcelId, ulpin, proposedGeometry, controlPointIds, deviations, reason, user: req.user })
    ok(res, doc)
  } catch (e) {
    if (e.status === 404) throw notFoundError(e.message)
    throw e
  }
})

export const listGeometryProposals = asyncHandler(async (req, res) => {
  const { ulpin, reviewStatus } = req.query
  const filter = {}
  if (ulpin) filter.ulpin = ulpin
  if (reviewStatus) filter.reviewStatus = reviewStatus
  const rows = await listProposals(filter)
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: AI_GNSS_DISCLAIMER })
})

export const getGeometryProposal = asyncHandler(async (req, res) => {
  const row = await getProposal(req.params.id)
  if (!row) throw notFoundError(`No geometry review proposal ${req.params.id}`)
  ok(res, publicDoc(row))
})

const PROPOSAL_ACTIONS = ['ACCEPT', 'REJECT']

export const reviewGeometryProposal = asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '').toUpperCase()
  if (!PROPOSAL_ACTIONS.includes(action)) throw badRequest(`action must be one of ${PROPOSAL_ACTIONS.join(', ')}`)
  const existing = await getProposal(req.params.id)
  if (!existing) throw notFoundError(`No geometry review proposal ${req.params.id}`)
  if (existing.reviewStatus !== 'PENDING_REVIEW') throw badRequest(`Proposal is already ${existing.reviewStatus}.`)
  try {
    const updated = await reviewProposal(req.params.id, action, req.user, req.ip)
    ok(res, publicDoc(updated))
  } catch (e) {
    if (e.status === 400) throw badRequest(e.message)
    throw e
  }
})
