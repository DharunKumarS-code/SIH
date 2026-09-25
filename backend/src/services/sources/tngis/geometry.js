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

// Chennai revenue district code in the public TNGIS GeoServer (`district_code`
// on `cadastral_analysis:cadastral_ulpin`; the generic_api uses the 2-digit
// string '02', LGD 568). Used to keep the viewport loader Chennai-only.
export const CHENNAI_DISTRICT_CODE = 2

// A single viewport WFS read may never be a whole-district download. GeoServer
// returns ~74k parcels for Chennai; a viewport with these bounds returns a few
// hundred at most. Anything wider is refused by the controller.
export const VIEWPORT_MAX_SPAN_DEG = 0.14 // ~15 km
export const VIEWPORT_FEATURE_CAP = 400

const r3 = (n) => Number(n).toFixed(3)

/**
 * Every public Chennai cadastral parcel whose geometry intersects a map
 * viewport, from the public GeoServer WFS (`cadastral_analysis:cadastral_ulpin`).
 * Returned VERBATIM — geometry is not simplified, reprojected or rounded.
 *
 * This is a bounded VIEWPORT read: one WFS `GetFeature` filtered by
 * `BBOX(the_geom, …) AND district_code=<Chennai>` and hard-capped at `count`
 * features. There is deliberately no "fetch the district" path.
 *
 * @returns the upstream WFS FeatureCollection (with `numberMatched`).
 */
export async function getCadastralParcelsInViewport({
  minLon, minLat, maxLon, maxLat, count = VIEWPORT_FEATURE_CAP, districtCode = CHENNAI_DISTRICT_CODE,
}) {
  // GeoServer BBOX() axis order matches the requested srsName
  // (urn:ogc:def:crs:EPSG::4326 → lat,lon). Verified against the live service.
  const cql =
    `BBOX(the_geom,${minLat},${minLon},${maxLat},${maxLon}) AND district_code=${Number(districtCode)}`
  const key = `wfs:bbox:${r3(minLon)},${r3(minLat)},${r3(maxLon)},${r3(maxLat)}`
  const fc = await wfsGetFeature(cql, key, { count })
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection', features: [], numberMatched: 0 }
  }
  return fc
}

/** Ring-average centroid of a Polygon / MultiPolygon (EPSG:4326, lon/lat). */
export function centroidOfGeometry(geometry) {
  const rings =
    geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat()
      : geometry?.type === 'Polygon' ? geometry.coordinates
        : []
  const pts = []
  for (const ring of rings) for (const c of ring || []) {
    if (Number.isFinite(c?.[0]) && Number.isFinite(c?.[1])) pts.push(c)
  }
  if (!pts.length) return null
  const s = pts.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
  return {
    longitude: Number((s[0] / pts.length).toFixed(9)),
    latitude: Number((s[1] / pts.length).toFixed(9)),
  }
}

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
