// ---------------------------------------------------------------------------
// TNGIS public parcel geometry.
//
// Two public paths, both returning GeoJSON in EPSG:4326 (WGS84), lon/lat order:
//   - generic_api/v1/get_geom  (primary — the exact call the GI Viewer makes)
//   - GeoServer WFS 2.0.0 GetFeature on `cadastral_analysis:cadastral_ulpin`
//     (secondary — adds the source record id + LGD codes + timestamps)
//
// The source geometry is returned VERBATIM. Nothing is simplified, reprojected
// or rounded here (spec section 4).
// ---------------------------------------------------------------------------

import { getGeom, wfsGetFeature } from './client.js'

export const SOURCE_CRS = 'EPSG:4326'

/**
 * Raw parcel geometry for a survey number, from generic_api/v1/get_geom.
 * @returns the upstream FeatureCollection (unaltered) — `{ type, features }`.
 */
export async function getSurveyGeometry({ districtCode, talukCode, villageCode, surveyNumber, codeType = 'revenue' }) {
  const dc = String(districtCode)
  const tc = String(talukCode)
  const vc = String(villageCode)
  const sn = String(surveyNumber)
  const res = await getGeom(
    {
      case: 'survey_number',
      code_type: codeType,
      district_code: dc,
      taluk_code: tc,
      village_code: vc,
      survey_number: sn,
    },
    `geom:survey_number:${dc}:${tc}:${vc}:${sn}`,
  )
  const fc = res?.data && res.data.type === 'FeatureCollection' ? res.data : res
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection', features: [] }
  }
  return fc
}

/** Raw boundary geometry for a whole taluk / village (context, not a parcel). */
export async function getAdminGeometry({ scope, districtCode, talukCode, villageCode, codeType = 'revenue' }) {
  const key = ['geom', scope, districtCode, talukCode, villageCode || ''].join(':')
  const res = await getGeom(
    {
      case: scope, // 'taluk' | 'village'
      code_type: codeType,
      district_code: String(districtCode),
      taluk_code: String(talukCode),
      village_code: villageCode ? String(villageCode) : '',
      survey_number: '',
    },
    key,
  )
  return res?.data && res.data.type === 'FeatureCollection' ? res.data : res
}

/**
 * GeoServer WFS lookup for the same parcel — used to obtain the authoritative
 * `sourceRecordId`, LGD codes and `updated_at`. Returns `{ feature, properties }`
 * for the first match, or `null`.
 */
export async function getCadastralWfsFeature({ talukCode, villageCode, surveyNumber, subDivision }) {
  const clauses = [
    `survey_number='${String(surveyNumber).replace(/'/g, "''")}'`,
    `village_code='${String(villageCode).replace(/'/g, "''")}'`,
    `taluk_code=${Number(talukCode)}`,
  ]
  if (subDivision != null && subDivision !== '') clauses.push(`sub_division='${String(subDivision).replace(/'/g, "''")}'`)
  const cql = clauses.join(' AND ')
  const key = `wfs:${talukCode}:${villageCode}:${surveyNumber}${subDivision ? `:${subDivision}` : ''}`
  const fc = await wfsGetFeature(cql, key)
  const feature = Array.isArray(fc?.features) ? fc.features[0] : null
  if (!feature) return null
  return {
    feature,
    properties: feature.properties || {},
    numberMatched: fc.numberMatched ?? fc.totalFeatures ?? null,
    crs: fc.crs?.properties?.name || 'urn:ogc:def:crs:EPSG::4326',
  }
}

/** Merge multiple GeoJSON Feature geometries into one MultiPolygon (verbatim rings). */
export function mergeToMultiPolygon(features = []) {
  const polys = []
  for (const f of features) {
    const g = f?.geometry
    if (!g) continue
    if (g.type === 'MultiPolygon') polys.push(...g.coordinates)
    else if (g.type === 'Polygon') polys.push(g.coordinates)
  }
  return { type: 'MultiPolygon', coordinates: polys }
}
