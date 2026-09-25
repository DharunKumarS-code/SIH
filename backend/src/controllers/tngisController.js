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
  getCadastralParcelsInViewport, wfsCadastralFeatureToRecord,
  VIEWPORT_MAX_SPAN_DEG, VIEWPORT_FEATURE_CAP,
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
    discovery: 'EXPLICIT_FETCH', // user drilled District→Taluk→Village→Survey (vs viewport BBOX)
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

// One TNGIS parcel record -> one GeoJSON Feature for the Cesium "TNGIS Parcels"
// layer. Shared by the cached-parcel layer and the viewport (BBOX) loader so
// both render identically. officialULPIN is ALWAYS null.
export const parcelLayerFeature = (r) => ({
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
    discovery: r.discovery || null,
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
})

// GET /api/gis/tngis-parcels — GeoJSON for the OFF-by-default "TNGIS Parcels"
// layer inside the EXISTING Chennai-wide Cesium viewer. Emits cached parcels
// with usable geometry. `?excludeViewport=1` returns only parcels a user
// explicitly fetched (District→Taluk→Village→Survey), not viewport-discovered
// ones — the Cesium map uses that so the viewport loader owns viewport parcels.
export const gisTngisParcels = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.locality) filter.locality = String(req.query.locality)
  if (req.query.districtCode) filter.districtCode = String(req.query.districtCode)
  if (req.query.excludeViewport === '1' || req.query.excludeViewport === 'true') {
    filter.discovery = { $ne: 'VIEWPORT_WFS' }
  }
  const rows = await db.collection(COLL).find(filter, { sort: { updatedAt: -1 } })
  const features = rows
    .filter((r) => r.geometry && Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length)
    .map(parcelLayerFeature)
  ok(res, { type: 'FeatureCollection', features, disclaimer: TNGIS_DISCLAIMER })
})

/* ----------------------------------------- Chennai-wide viewport (BBOX) layer */
// GET /api/gis/tngis-parcels/bbox?bbox=minLon,minLat,maxLon,maxLat&limit=
//
// Progressive, viewport-bounded official parcel geometry for the WHOLE Chennai
// extent — one public GeoServer WFS GetFeature filtered to the current map view
// AND district_code=Chennai, hard-capped at VIEWPORT_FEATURE_CAP. Refuses a
// viewport wider than VIEWPORT_MAX_SPAN_DEG (client must zoom in) so the browser
// never pulls the whole ~74k-parcel district. Fetched parcels are cached in the
// `tngisParcels` collection (discovery: 'VIEWPORT_WFS') as a read-through cache
// of already-public geometry — the RBAC-gated POST /parcels/fetch is unchanged.
export const gisTngisParcelsViewport = asyncHandler(async (req, res) => {
  const nums = String(req.query.bbox || '').split(',').map(Number)
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    throw badRequest('bbox=minLon,minLat,maxLon,maxLat (EPSG:4326 decimal degrees) is required')
  }
  let [minLon, minLat, maxLon, maxLat] = nums
  if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon]
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat]

  if (maxLon - minLon > VIEWPORT_MAX_SPAN_DEG || maxLat - minLat > VIEWPORT_MAX_SPAN_DEG) {
    return ok(res, {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'TNGIS_WFS_VIEWPORT',
        zoomInRequired: true,
        maxSpanDeg: VIEWPORT_MAX_SPAN_DEG,
        reason: 'Viewport too large for parcel detail — zoom in to load TNGIS parcels.',
      },
      disclaimer: TNGIS_DISCLAIMER,
    })
  }

  const cap = Math.max(1, Math.min(Number(req.query.limit) || VIEWPORT_FEATURE_CAP, VIEWPORT_FEATURE_CAP))
  const persist = req.query.persist !== '0'

  let fc
  try {
    fc = await getCadastralParcelsInViewport({ minLon, minLat, maxLon, maxLat, count: cap })
  } catch (e) {
    if (e instanceof TngisSourceUnavailable) throw badRequest(`TNGIS source temporarily unavailable: ${e.message}`)
    throw e
  }

  // Best-effort taluk names (one cached admin-master call; never blocks).
  const talukNames = {}
  try {
    for (const t of await listTaluks('02')) talukNames[String(t.talukCode)] = t.name
  } catch { /* names optional — codes/LGD are still authoritative */ }

  const now = new Date().toISOString()
  const records = (fc.features || [])
    .map((f) => wfsCadastralFeatureToRecord(f, now, { talukName: talukNames[String(f?.properties?.taluk_code)] }))
    .filter(Boolean)
    .map((r) => ({ ...r, locality: nearestLocality(r.centroid) }))

  // Read-through cache — batched: one lookup for what we already have, one
  // insert for the rest. Existing rows are left as-is (parcel geometry is
  // stable), so a viewport pan costs 1 read + 1 write, not O(features).
  if (persist && records.length) {
    try {
      const ids = records.map((r) => r.sourceRecordId)
      const have = new Set(
        (await db.collection(COLL).find({ sourceRecordId: { $in: ids } }, { projection: { sourceRecordId: 1 } }))
          .map((d) => d.sourceRecordId),
      )
      const fresh = records
        .filter((r) => !have.has(r.sourceRecordId))
        .map((r) => ({ ...r, discovery: 'VIEWPORT_WFS', fetchedBy: null, firstFetchedAt: now, updatedAt: now }))
      if (fresh.length) await db.collection(COLL).insertMany(fresh)
    } catch { /* cache write is best-effort — never fail the map request */ }
  }

  const features = records.filter((r) => r.geometry).map(parcelLayerFeature)
  ok(res, {
    type: 'FeatureCollection',
    features,
    meta: {
      source: 'TNGIS_WFS_VIEWPORT',
      bbox: [minLon, minLat, maxLon, maxLat],
      numberMatched: Number.isFinite(fc.numberMatched) ? fc.numberMatched : null,
      returned: features.length,
      cap,
      truncated: Number.isFinite(fc.numberMatched) && fc.numberMatched > features.length,
      persisted: persist,
    },
    disclaimer: TNGIS_DISCLAIMER,
  })
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
