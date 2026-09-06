// Phase 8 — underground 3D infrastructure mapping API (additive).
//
// Every response makes the non-official nature explicit (isOfficial: false on
// demo/uploaded records, UNDERGROUND_DISCLAIMER on collections). Infrastructure
// lives in its own `undergroundInfrastructure` collection; the existing
// parcels/buildings/floors/propertyUnits collections are NEVER touched.
//
// Provenance is never auto-promoted; a spatial relationship is never turned
// into a legal ownership claim; depth/elevation are only ever reported when the
// source supplied them.

import multer from 'multer'
import { db } from '../store/index.js'
import { env } from '../config/env.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import {
  UploadValidationError, validateUpload, parseAndValidate, importInfrastructure,
  runInfrastructureValidation, collisionAnalysis, elevationContextForInfrastructure,
  undergroundPipelineConfig, UNDERGROUND_DISCLAIMER,
} from '../services/underground/index.js'
import { associate } from '../services/underground/associate.js'
import { verticalBand, geomShape } from '../services/underground/geometry.js'
import { LOCALITIES } from '../data/localities.js'

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.infraMaxUploadMb * 1024 * 1024, files: 1 },
}).single('file')

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

const parseFieldMap = (raw) => {
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

/* --------------------------------------------------------------- config */
export const getConfig = asyncHandler(async (_req, res) => {
  ok(res, await undergroundPipelineConfig())
})

/* -------------------------------------------------------- list / detail */
export const listInfrastructure = asyncHandler(async (req, res) => {
  const { type, area, locality, parcel, building, status, source, verificationStatus, ownerAuthority, maxDepthM, minDepthM, limit } = req.query
  const filter = {}
  const loc = area || locality
  if (loc) filter.locality = loc
  if (type) filter.type = type
  if (parcel) filter.parentParcel = parcel
  if (building) filter.parentBuilding = building
  if (status) filter.status = status
  if (source) filter.source = source
  if (verificationStatus) filter.verificationStatus = verificationStatus
  if (ownerAuthority) filter.ownerAuthority = ownerAuthority

  let rows = await db.collection('undergroundInfrastructure').find(filter, {
    sort: { createdAt: -1 }, limit: limit ? Number(limit) : undefined,
  })
  // depth filter is applied in JS: depthBelowSurface is null for many records
  // and must not silently exclude them unless a bound was actually requested.
  if (minDepthM != null || maxDepthM != null) {
    const lo = minDepthM != null ? Number(minDepthM) : -Infinity
    const hi = maxDepthM != null ? Number(maxDepthM) : Infinity
    rows = rows.filter((r) => Number.isFinite(r.depthBelowSurfaceM) && r.depthBelowSurfaceM >= lo && r.depthBelowSurfaceM <= hi)
  }
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: UNDERGROUND_DISCLAIMER })
})

export const getInfrastructure = asyncHandler(async (req, res) => {
  const row = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: req.params.id })
  if (!row) throw notFoundError(`No underground infrastructure ${req.params.id}`)
  ok(res, publicDoc(row))
})

/* --------------------------------------------------------- GIS layer */
// GET /api/gis/underground-infrastructure — GeoJSON for the EXISTING Chennai
// Cesium viewer's optional, OFF-by-default "Underground Infrastructure" layer.
// Only records with usable WGS84 geometry are rendered; a record whose CRS
// transform failed is never placed with a guessed position.
export const gisUndergroundInfrastructure = asyncHandler(async (req, res) => {
  const { locality, type, source, verificationStatus, status } = req.query
  const filter = {}
  if (locality) filter.locality = locality
  if (type) filter.type = type
  if (source) filter.source = source
  if (verificationStatus) filter.verificationStatus = verificationStatus
  if (status) filter.status = status
  const rows = await db.collection('undergroundInfrastructure').find(filter, { sort: { createdAt: -1 } })

  const features = rows
    .map((r) => {
      if (!r.geometry || r.crsStatus === 'TRANSFORMATION_FAILED' || r.crsStatus === 'UNKNOWN') return null
      const band = verticalBand(r)
      return {
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          infrastructureId: r.infrastructureId,
          type: r.type,
          subtype: r.subtype,
          status: r.status,
          ownerAuthority: r.ownerAuthority,
          diameterM: r.diameterM,
          widthM: r.widthM,
          heightM: r.heightM,
          surfaceElevationM: r.surfaceElevationM,
          topElevationM: band ? Number(band.top.toFixed(3)) : r.topElevationM ?? null,
          bottomElevationM: band ? Number(band.bottom.toFixed(3)) : r.bottomElevationM ?? null,
          depthBelowSurfaceM: r.depthBelowSurfaceM,
          depthReference: r.depthReference,
          verticalDatum: r.verticalDatum,
          verticalStatus: r.verticalStatus,
          crsStatus: r.crsStatus,
          source: r.source,
          verificationStatus: r.verificationStatus,
          isOfficial: Boolean(r.isOfficial),
          spatialRelation: r.spatialRelation,
          parentParcel: r.parentParcel,
          parentBuilding: r.parentBuilding,
          locality: r.locality,
        },
      }
    })
    .filter(Boolean)
  ok(res, { type: 'FeatureCollection', features, disclaimer: UNDERGROUND_DISCLAIMER })
})

/* --------------------------------------------------------- relations */
// Spatial relationship + legal ownership are returned as SEPARATE facts
// (spec sections 11-12, 32). A spatial intersection is never an ownership claim.
export const getRelations = asyncHandler(async (req, res) => {
  const row = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: req.params.id })
  if (!row) throw notFoundError(`No underground infrastructure ${req.params.id}`)
  const [parcels, buildings] = await Promise.all([
    db.collection('parcels').find({ locality: row.locality }),
    db.collection('buildings').find({ locality: row.locality }),
  ])
  const assoc = associate(row, parcels, buildings)

  // Nearby utilities that this asset intersects or runs parallel to (spec
  // section 12) — INTERSECTS_UTILITY / PARALLEL_TO_UTILITY, geometry only.
  const others = await db.collection('undergroundInfrastructure').find({ locality: row.locality, infrastructureId: { $ne: row.infrastructureId } })
  const shape = geomShape(row)
  const utilityRelations = []
  if (shape) {
    const bb = shape.bbox
    for (const o of others) {
      const os = geomShape(o)
      if (!os) continue
      const overlaps = bb[0] <= os.bbox[2] && os.bbox[0] <= bb[2] && bb[1] <= os.bbox[3] && os.bbox[1] <= bb[3]
      if (overlaps) utilityRelations.push({ infrastructureId: o.infrastructureId, type: o.type, spatialRelation: 'INTERSECTS_UTILITY' })
    }
  }

  ok(res, {
    infrastructureId: row.infrastructureId,
    spatialRelation: assoc.spatialRelation,
    parcelRelations: assoc.parcelRelations,
    buildingRelations: assoc.buildingRelations,
    utilityRelations,
    // legal facts — SEPARATE from the geometry facts above
    ownerAuthority: row.ownerAuthority || null,
    legalOwnership: row.legalOwnership || 'NOT_PROVIDED',
    ownershipNote: 'Spatial intersection does not establish legal ownership. Legal ownership is only shown when authoritative data supplies it.',
    disclaimer: UNDERGROUND_DISCLAIMER,
  })
})

/* --------------------------------------------------------- elevation */
export const getElevation = asyncHandler(async (req, res) => {
  const row = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: req.params.id })
  if (!row) throw notFoundError(`No underground infrastructure ${req.params.id}`)
  ok(res, { infrastructureId: row.infrastructureId, ...(await elevationContextForInfrastructure(row)) })
})

/* -------------------------------------------------------- upload flow */
export const uploadValidate = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (multipart field "file").')
  try {
    validateUpload(req.file, { maxMb: env.infraMaxUploadMb })
    const result = await parseAndValidate({
      text: req.file.buffer.toString('utf-8'),
      format: formatFromReq(req),
      fieldMap: parseFieldMap(req.body?.fieldMap),
      locality: req.body?.locality,
      batchCrs: req.body?.crs || undefined,
    })
    ok(res, result)
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

export const uploadImport = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (multipart field "file").')
  try {
    validateUpload(req.file, { maxMb: env.infraMaxUploadMb })
    const result = await importInfrastructure({
      text: req.file.buffer.toString('utf-8'),
      format: formatFromReq(req),
      fieldMap: parseFieldMap(req.body?.fieldMap),
      locality: req.body?.locality,
      sourceLabel: req.body?.sourceLabel,
      provenanceNote: req.body?.provenanceNote,
      batchCrs: req.body?.crs || undefined,
      user: req.user,
    })
    ok(res, { ...result, infrastructure: result.infrastructure.map(publicDoc) })
  } catch (e) {
    if (e instanceof UploadValidationError) throw badRequest(e.message)
    throw e
  }
})

/* --------------------------------------------------- deterministic validation */
export const validateInfrastructure = asyncHandler(async (req, res) => {
  const { scope, locality, infrastructureId } = req.body || {}
  let doc
  if (scope === 'infrastructure' || infrastructureId) {
    if (!infrastructureId) throw badRequest('infrastructureId is required for scope "infrastructure".')
    const exists = await db.collection('undergroundInfrastructure').findOne({ infrastructureId })
    if (!exists) throw notFoundError(`No underground infrastructure ${infrastructureId}`)
    doc = await runInfrastructureValidation({ scopeType: 'infrastructure', scopeId: infrastructureId }, { user: req.user })
  } else if (scope === 'locality' || locality) {
    doc = await runInfrastructureValidation({ scopeType: 'locality', scopeId: locality }, { user: req.user })
  } else {
    doc = await runInfrastructureValidation({ scopeType: 'all' }, { user: req.user })
  }
  ok(res, publicDoc(doc))
})

export const listValidationResults = asyncHandler(async (req, res) => {
  const { scopeType, limit } = req.query
  const filter = {}
  if (scopeType) filter.scopeType = scopeType
  const rows = await db.collection('infrastructureValidationResults').find(filter, {
    sort: { createdAt: -1 }, limit: limit ? Number(limit) : 20, projection: { findings: 0 },
  })
  list(res, rows.map(publicDoc), { total: rows.length, disclaimer: UNDERGROUND_DISCLAIMER })
})

export const getValidationResult = asyncHandler(async (req, res) => {
  const row = await db.collection('infrastructureValidationResults').findOne({ validationRunId: req.params.id })
  if (!row) throw notFoundError(`No infrastructure validation run ${req.params.id}`)
  ok(res, publicDoc(row))
})

/* ----------------------------------------- 3D intersection / clearance */
export const getCollisions = asyncHandler(async (req, res) => {
  const locality = req.body?.locality || req.query?.locality
  const infrastructureIds = req.body?.infrastructureIds
  ok(res, await collisionAnalysis({ locality, infrastructureIds }))
})

/* ------------------------------------------------------------- review */
const REVIEW_ACTIONS = ['ACKNOWLEDGED', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION']

// A lightweight, data-level review — records that a reviewer looked at a
// record. It NEVER promotes `source` to official and NEVER modifies geometry
// or depth (spec sections 4, 21).
export const reviewInfrastructure = asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '').toUpperCase()
  if (!REVIEW_ACTIONS.includes(action)) throw badRequest(`action must be one of ${REVIEW_ACTIONS.join(', ')}`)
  const row = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: req.params.id })
  if (!row) throw notFoundError(`No underground infrastructure ${req.params.id}`)
  const updated = await db.collection('undergroundInfrastructure').updateOne(
    { infrastructureId: req.params.id },
    {
      reviewAction: action,
      reviewedBy: req.user?.username || null,
      reviewedAt: new Date().toISOString(),
      // source / verificationStatus / geometry / depth are deliberately NOT changed here
    },
  )
  ok(res, publicDoc(updated))
})

/* ---------------------------------------------------------- summary */
export const getSummary = asyncHandler(async (req, res) => {
  const { locality } = req.query
  const filter = {}
  if (locality) filter.locality = locality
  const [rows, all] = await Promise.all([
    db.collection('undergroundInfrastructure').find(filter),
    db.collection('undergroundInfrastructure').find({}),
  ])
  const by = (key) => rows.reduce((m, r) => { m[r[key] || 'UNKNOWN'] = (m[r[key] || 'UNKNOWN'] || 0) + 1; return m }, {})
  ok(res, {
    total: rows.length,
    byType: by('type'),
    bySource: by('source'),
    byVerification: by('verificationStatus'),
    byStatus: by('status'),
    official: rows.filter((r) => r.isOfficial).length,
    demo: rows.filter((r) => !r.isOfficial).length,
    depthKnown: rows.filter((r) => Number.isFinite(r.depthBelowSurfaceM)).length,
    depthUnknown: rows.filter((r) => !Number.isFinite(r.depthBelowSurfaceM)).length,
    // the per-locality breakdown is always the global picture, not the filtered subset
    localities: LOCALITIES.map((l) => ({ id: l.id, name: l.name, count: all.filter((r) => r.locality === l.id).length })),
    disclaimer: UNDERGROUND_DISCLAIMER,
  })
})
