// ---------------------------------------------------------------------------
// TNGIS viewport parcels — map ONE public GeoServer WFS cadastral feature to
// our normalized parcel record.
//
// PURE. No network, no clock except the `retrievedAt` passed in. Produces the
// same field shape as normalize.js (so the GeoJSON layer serializer is shared)
// with `officialULPIN` ALWAYS null — the public `cadastral_ulpin` layer has no
// ULPIN column, and it is never fabricated.
// ---------------------------------------------------------------------------

import {
  TNGIS_PROVENANCE, OFFICIAL_ULPIN_UNAVAILABLE, TNGIS_DISCLAIMER,
} from './provenance.js'
import { SOURCE_CRS, centroidOfGeometry } from './geometry.js'

const str = (v) => (v == null || v === '' ? null : String(v))
const pad2 = (v) => {
  const s = str(v)
  return s == null ? null : s.padStart(2, '0')
}
const pad3 = (v) => {
  const s = str(v)
  return s == null ? null : s.padStart(3, '0')
}

/**
 * @param {object} feature  a GeoJSON Feature from `cadastral_analysis:cadastral_ulpin`
 * @param {string} retrievedAt  ISO timestamp
 * @param {object} [names]  optional { talukName } resolved from the admin master
 * @returns {object|null} normalized record, or null if the feature has no geometry
 */
export function wfsCadastralFeatureToRecord(feature, retrievedAt, names = {}) {
  const p = feature?.properties || {}
  const geometry =
    feature?.geometry && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length
      ? feature.geometry
      : null
  if (!geometry) return null

  const districtCode = pad2(p.district_code) // '2' -> '02', matching the generic_api codes
  const talukCode = str(p.taluk_code)
  const villageCode = pad3(p.village_code)
  const surveyNumber = str(p.survey_number) ?? str(p.kide)

  const sourceRecordId =
    p.id != null
      ? `tngis:cadastral_ulpin:${p.id}`
      : `tngis:generic_api:${districtCode}-${talukCode}-${villageCode}-${surveyNumber}`

  return {
    ...TNGIS_PROVENANCE,

    // ULPIN rule — never fabricated, never from an authenticated screen.
    officialULPIN: null,
    officialULPINStatus: OFFICIAL_ULPIN_UNAVAILABLE,

    districtCode,
    lgdDistrictCode: str(p.lgd_district_code),
    districtName: 'Chennai', // district_code=2 is Chennai by construction of the query
    talukCode,
    lgdTalukCode: str(p.lgd_taluk_code),
    talukName: names.talukName || null,
    villageCode,
    lgdVillageCode: str(p.lgd_village_code),
    villageName: null, // not resolved on the lightweight viewport path — shown as LGD code, never invented

    surveyNumber,
    subDivision: str(p.sub_division), // null in the public layer for most parcels — not fabricated

    centroid: centroidOfGeometry(geometry),

    geometry,
    geometryType: geometry.type,
    sourceCRS: SOURCE_CRS,

    isFmb: p.is_fmb != null ? Boolean(p.is_fmb) : null,
    landType: str(p.land_type),
    areaSqm: null, // not provided by the public layer

    sourceRecordId,
    sourceUpdatedAt: str(p.updated_at) || null,
    sourceCreatedAt: str(p.created_at) || null,
    sourceFeatureCount: 1,

    retrievedAt,
    disclaimer: TNGIS_DISCLAIMER,
  }
}
