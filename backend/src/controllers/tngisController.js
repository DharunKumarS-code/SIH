// ---------------------------------------------------------------------------
// TNGIS / Tamil Nilam — PUBLIC parcel-geometry integration controller.
//
// Reads ONLY the public, unauthenticated TNGIS endpoints via the isolated
// adapter in services/sources/tngis/. Fetched parcels are cached in the
// `tngisParcels` collection (own collection — never touches parcels/buildings/
// floors/propertyUnits). officialULPIN is ALWAYS null. The authenticated /
// encrypted TNGIS API is never called.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { db } from '../store/index.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { LOCALITIES } from '../data/localities.js'
import {
  tngisConfig, listDistricts, listTaluks, listVillages, listSurveyNumbers,
  fetchParcel, TngisSourceUnavailable, OFFICIAL_ULPIN_UNAVAILABLE, TNGIS_DISCLAIMER,
} from '../services/sources/tngis/index.js'
import { relateBuildings, principalRing } from '../services/sources/tngis/relations.js'
import { evaluate } from '../services/topology/index.js'

const COLL = 'tngisParcels'

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

/* --------------------------------------------------------------- config */
export const getConfig = asyncHandler(async (_req, res) => ok(res, tngisConfig()))

/* --------------------------------------------------- admin hierarchy (lazy) */
const wrapSource = async (res, fn) => {
  try {
    ok(res, await fn())
  } catch (e) {
    if (e instanceof TngisSourceUnavailable) throw badRequest(`TNGIS source temporarily unavailable: ${e.message}`)
    throw e
  }
}

export const getDistricts = asyncHandler((req, res) => wrapSource(res, () => listDistricts()))

export const getTaluks = asyncHandler((req, res) => {
  const { districtCode } = req.query
  if (!districtCode) throw badRequest('districtCode is required')
  return wrapSource(res, () => listTaluks(districtCode))
})

export const getVillages = asyncHandler((req, res) => {
  const { districtCode, talukCode } = req.query
  if (!districtCode || !talukCode) throw badRequest('districtCode and talukCode are required')
  return wrapSource(res, () => listVillages(districtCode, talukCode))
})

export const getSurveyNumbers = asyncHandler((req, res) => {
  const { districtCode, talukCode, villageCode, areaType } = req.query
  if (!districtCode || !talukCode || !villageCode) throw badRequest('districtCode, talukCode and villageCode are required')
  return wrapSource(res, async () => ({
    surveyNumbers: await listSurveyNumbers(districtCode, talukCode, villageCode, { areaType: areaType || 'rural' }),
  }))
})

/* -------------------------------------------- fetch + cache ONE parcel */
export const fetchParcelSchema = {
  body: z.object({
    districtCode: z.string().min(1),
    talukCode: z.string().min(1),
    villageCode: z.string().min(1),
    surveyNumber: z.string().min(1),
    subDivision: z.string().optional().nullable(),
  }),
}

export const fetchOneParcel = asyncHandler(async (req, res) => {
  const q = req.body
  let record
  try {
    record = await fetchParcel(q)
  } catch (e) {
    if (e instanceof TngisSourceUnavailable) throw badRequest(`TNGIS source temporarily unavailable: ${e.message}`)
    if (e.code === 'TNGIS_BAD_QUERY') throw badRequest(e.message)
    throw e
  }

  const now = new Date().toISOString()
  const stored = {
    ...record,
    // spatial pointer to the nearest project locality (for the Cesium layer's
    // area-tag + demand loading) — NOT an authoritative admin mapping.
    locality: nearestLocality(record.centroid),
    fetchedBy: req.user?.username || null,
    firstFetchedAt: now,
    updatedAt: now,
  }
  const existing = await db.collection(COLL).findOne({ sourceRecordId: record.sourceRecordId })
  if (existing) {
    await db.collection(COLL).updateOne(
      { sourceRecordId: record.sourceRecordId },
      { ...stored, firstFetchedAt: existing.firstFetchedAt || now },
    )
  } else {
    await db.collection(COLL).create(stored)
  }
  ok(res, publicDoc(await db.collection(COLL).findOne({ sourceRecordId: record.sourceRecordId })))
})

/* ------------------------------------------------ list / detail (cached) */
export const listParcels = asyncHandler(async (req, res) => {
  const { districtCode, talukCode, villageCode, surveyNumber, locality, limit, page } = req.query
  const filter = {}
  if (districtCode) filter.districtCode = String(districtCode)
  if (talukCode) filter.talukCode = String(talukCode)
  if (villageCode) filter.villageCode = String(villageCode)
  if (surveyNumber) filter.surveyNumber = String(surveyNumber)
  if (locality) filter.locality = String(locality)
  const total = await db.collection(COLL).count(filter)
  const lim = Math.min(Number(limit) || 50, 200)
  const skip = page ? (Math.max(1, Number(page)) - 1) * lim : 0
  const rows = await db.collection(COLL).find(filter, { sort: { updatedAt: -1 }, limit: lim, skip })
  list(res, rows.map(publicDoc), { total, disclaimer: TNGIS_DISCLAIMER })
})

export const getParcel = asyncHandler(async (req, res) => {
  const row = await db.collection(COLL).findOne({ sourceRecordId: req.params.id })
  if (!row) throw notFoundError(`No cached TNGIS parcel ${req.params.id}. POST /api/tngis/parcels/fetch first.`)
  ok(res, publicDoc(row))
})

/* --------------------------------------------------------- GIS layer */
// GET /api/gis/tngis-parcels — GeoJSON for the OFF-by-default "TNGIS Parcels"
// layer inside the EXISTING Chennai-wide Cesium viewer. Only cached parcels
// with usable geometry are emitted; nothing is bulk-fetched here.
export const gisTngisParcels = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.locality) filter.locality = String(req.query.locality)
  if (req.query.districtCode) filter.districtCode = String(req.query.districtCode)
  const rows = await db.collection(COLL).find(filter, { sort: { updatedAt: -1 } })
  const features = rows
    .filter((r) => r.geometry && Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length)
    .map((r) => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: {
        kind: 'tngis-parcel',
        sourceRecordId: r.sourceRecordId,
        source: r.source,
        sourceType: r.sourceType,
        provenance: r.provenance,
        verificationStatus: r.verificationStatus,
        sourceGeometry: true,
        officialULPIN: null,
        officialULPINStatus: r.officialULPINStatus || OFFICIAL_ULPIN_UNAVAILABLE,
        districtCode: r.districtCode,
        districtName: r.districtName,
        lgdDistrictCode: r.lgdDistrictCode,
        talukCode: r.talukCode,
        talukName: r.talukName,
        lgdTalukCode: r.lgdTalukCode,
        villageCode: r.villageCode,
        villageName: r.villageName,
        lgdVillageCode: r.lgdVillageCode,
        surveyNumber: r.surveyNumber,
        subDivision: r.subDivision,
        centroidLatitude: r.centroid?.latitude ?? null,
        centroidLongitude: r.centroid?.longitude ?? null,
        sourceCRS: r.sourceCRS,
        sourceUpdatedAt: r.sourceUpdatedAt,
        retrievedAt: r.retrievedAt,
        locality: r.locality,
      },
    }))
  ok(res, { type: 'FeatureCollection', features, disclaimer: TNGIS_DISCLAIMER })
})

/* ------------------------------------------------- relations (buildings) */
export const getRelations = asyncHandler(async (req, res) => {
  const row = await db.collection(COLL).findOne({ sourceRecordId: req.params.id })
  if (!row) throw notFoundError(`No cached TNGIS parcel ${req.params.id}`)
  if (!row.geometry) return ok(res, { sourceRecordId: row.sourceRecordId, buildingRelations: [], note: 'No geometry to relate.' })
  const buildings = await db.collection('buildings').find(row.locality ? { locality: row.locality } : {})
  const buildingRelations = relateBuildings(row.geometry, buildings)
  ok(res, {
    sourceRecordId: row.sourceRecordId,
    buildingRelations,
    ownershipNote:
      'Spatial intersection does NOT establish legal ownership. Ownership is only shown from authoritative legal records, which the public TNGIS source does not provide.',
    disclaimer: TNGIS_DISCLAIMER,
  })
})

/* ---------------------------------------- topology validation (Phase 7) */
export const validateTopology = asyncHandler(async (req, res) => {
  const row = await db.collection(COLL).findOne({ sourceRecordId: req.params.id })
  if (!row) throw notFoundError(`No cached TNGIS parcel ${req.params.id}`)
  if (!row.geometry) throw badRequest('This TNGIS parcel has no geometry to validate.')

  const ring = principalRing(row.geometry)
  if (!ring || ring.length < 4) throw badRequest('TNGIS parcel geometry has no usable outer ring.')

  // Reuse the EXISTING Phase 7 engine (no second engine). Feed it the parcel
  // alone (as a Polygon) — building/floor/unit rules simply see empty inputs.
  const parcelDoc = {
    ulpin: `TNGIS:${row.sourceRecordId}`,
    parcelId: row.sourceRecordId,
    locality: row.locality || null,
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
  let result
  try {
    result = await evaluate({ parcels: [parcelDoc], buildings: [], floors: [], units: [] })
  } catch (e) {
    throw badRequest(`Topology engine unavailable: ${e.message}`)
  }
  ok(res, {
    sourceRecordId: row.sourceRecordId,
    summary: result.summary,
    findings: result.findings,
    note: 'Deterministic Phase 7 topology validation over the TNGIS parcel geometry. Findings are shown as-is.',
  })
})

/* ----------------------------------------------------------- helpers */
const M_PER_DEG_LAT = 111_320
function nearestLocality(centroid) {
  if (!centroid || !Number.isFinite(centroid.latitude) || !Number.isFinite(centroid.longitude)) return null
  let best = null
  let bestD = Infinity
  for (const l of LOCALITIES) {
    const dLat = (centroid.latitude - l.base.lat) * M_PER_DEG_LAT
    const dLon = (centroid.longitude - l.base.lon) * M_PER_DEG_LAT * Math.cos((centroid.latitude * Math.PI) / 180)
    const d = Math.hypot(dLat, dLon)
    if (d < bestD) {
      bestD = d
      best = l.id
    }
  }
  // Only tag a locality when the parcel is plausibly within its demo extent
  // (~3 km); otherwise leave null so the Cesium layer shows it area-agnostically.
  return bestD <= 6000 ? best : null
}
