// ---------------------------------------------------------------------------
// TNGIS response -> our normalized parcel record (spec section 18).
//
// PURE. No network, no clock except the `retrievedAt` passed in. Only fields
// the public source actually returned are populated; everything protected is
// left null with an explicit sentinel. `officialULPIN` is ALWAYS null here.
// ---------------------------------------------------------------------------

import {
  TNGIS_PROVENANCE, OFFICIAL_ULPIN_UNAVAILABLE, TNGIS_DISCLAIMER,
} from './provenance.js'
import { SOURCE_CRS, mergeToMultiPolygon } from './geometry.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v) => (v == null || v === '' ? null : String(v))

/** Centroid from get_geom feature properties, else the ring average. */
function centroidOf(features) {
  for (const f of features) {
    const p = f?.properties || {}
    const lon = num(p.centroid_longitude)
    const lat = num(p.centroid_latitude)
    if (lon != null && lat != null) return { longitude: lon, latitude: lat }
  }
  const pts = []
  for (const f of features) {
    const g = f?.geometry
    const rings = g?.type === 'MultiPolygon' ? g.coordinates.flat() : g?.type === 'Polygon' ? g.coordinates : []
    for (const ring of rings) for (const c of ring) if (Number.isFinite(c[0]) && Number.isFinite(c[1])) pts.push(c)
  }
  if (!pts.length) return null
  const s = pts.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
  return { longitude: Number((s[0] / pts.length).toFixed(9)), latitude: Number((s[1] / pts.length).toFixed(9)) }
}

/**
 * @param {object} args
 * @param {object} args.admin   { districtCode, lgdDistrictCode, talukCode, lgdTalukCode, villageCode, lgdVillageCode, districtName, talukName, villageName, surveyNumber, subDivision }
 * @param {object} args.geom    upstream get_geom FeatureCollection
 * @param {object|null} args.wfs { properties, numberMatched, crs } from GeoServer WFS (optional)
 * @param {string} args.retrievedAt  ISO timestamp
 */
export function normalizeParcel({ admin, geom, wfs = null, retrievedAt }) {
  const features = Array.isArray(geom?.features) ? geom.features : []
  const wp = wfs?.properties || {}

  const geometry = mergeToMultiPolygon(features)
  const hasGeometry = geometry.coordinates.length > 0

  const districtCode = str(admin.districtCode) || str(wp.district_code)
  const talukCode = str(admin.talukCode) || str(wp.taluk_code)
  const villageCode = str(admin.villageCode) || str(wp.village_code)
  const surveyNumber = str(admin.surveyNumber) || str(wp.survey_number) || str(wp.kide)

  const sourceRecordId = wp.id != null
    ? `tngis:cadastral_ulpin:${wp.id}`
    : `tngis:generic_api:${districtCode}-${talukCode}-${villageCode}-${surveyNumber}`

  return {
    // ---- provenance (spec section 5) ----
    ...TNGIS_PROVENANCE,

    // ---- ULPIN rule (spec section 6) — NEVER fabricated, NEVER from an
    // authenticated screen. The public source does not expose it. ----
    officialULPIN: null,
    officialULPINStatus: OFFICIAL_ULPIN_UNAVAILABLE,

    // ---- administrative hierarchy + LGD codes ----
    districtCode,
    lgdDistrictCode: str(admin.lgdDistrictCode) || str(wp.lgd_district_code),
    districtName: str(admin.districtName),
    talukCode,
    lgdTalukCode: str(admin.lgdTalukCode) || str(wp.lgd_taluk_code),
    talukName: str(admin.talukName),
    villageCode,
    lgdVillageCode: str(admin.lgdVillageCode) || str(wp.lgd_village_code),
    villageName: str(admin.villageName),

    surveyNumber,
    // Sub-division: only kept when the public source actually supplied one
    // (it was null for every public test parcel; the value on the GI Viewer
    // card comes from the login-gated API and is NOT integrated).
    subDivision: str(admin.subDivision) || str(wp.sub_division),

    centroid: centroidOf(features),

    geometry: hasGeometry ? geometry : null,
    geometryType: hasGeometry ? geometry.type : null,
    sourceCRS: SOURCE_CRS,

    isFmb: wp.is_fmb != null ? Boolean(wp.is_fmb) : null,
    landType: str(wp.land_type),
    areaSqm: null, // ext_ares / calculated_area were null in the public WFS view

    sourceRecordId,
    sourceUpdatedAt: str(wp.updated_at) || null,
    sourceCreatedAt: str(wp.created_at) || null,
    sourceFeatureCount: features.length || (wfs?.numberMatched ?? null),

    retrievedAt,
    disclaimer: TNGIS_DISCLAIMER,
  }
}
