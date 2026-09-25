// ---------------------------------------------------------------------------
// TNGIS / Tamil Nilam — PUBLIC-source parcel adapter (isolated).
//
// Own module tree. Reads ONLY the publicly reachable, unauthenticated TNGIS
// endpoints; never the authenticated/encrypted `gi_mvc` API. No credentials,
// sessions, cookies or CSRF tokens are used or stored. Full discovery:
// docs/tngis-source-discovery.md
// ---------------------------------------------------------------------------

import { TNGIS, TngisSourceUnavailable, __resetClientState } from './client.js'
import { listDistricts, listTaluks, listVillages, listSurveyNumbers } from './admin.js'
import {
  getSurveyGeometry, getAdminGeometry, getCadastralWfsFeature, SOURCE_CRS,
  getCadastralParcelsInViewport, centroidOfGeometry,
  CHENNAI_DISTRICT_CODE, VIEWPORT_MAX_SPAN_DEG, VIEWPORT_FEATURE_CAP,
} from './geometry.js'
import { fetchParcel } from './parcel.js'
import { normalizeParcel } from './normalize.js'
import { wfsCadastralFeatureToRecord } from './viewport.js'
import {
  TNGIS_SOURCE, TNGIS_SOURCE_TYPE, TNGIS_PROVENANCE, OFFICIAL_ULPIN_UNAVAILABLE,
  FIELD_CLASS, PARCEL_FIELD_CLASSES, classifyField, TNGIS_DISCLAIMER,
} from './provenance.js'

export {
  TngisSourceUnavailable, __resetClientState,
  listDistricts, listTaluks, listVillages, listSurveyNumbers,
  getSurveyGeometry, getAdminGeometry, getCadastralWfsFeature, SOURCE_CRS,
  getCadastralParcelsInViewport, centroidOfGeometry, wfsCadastralFeatureToRecord,
  CHENNAI_DISTRICT_CODE, VIEWPORT_MAX_SPAN_DEG, VIEWPORT_FEATURE_CAP,
  fetchParcel, normalizeParcel,
  TNGIS_SOURCE, TNGIS_SOURCE_TYPE, TNGIS_PROVENANCE, OFFICIAL_ULPIN_UNAVAILABLE,
  FIELD_CLASS, PARCEL_FIELD_CLASSES, classifyField, TNGIS_DISCLAIMER,
}

/** GET /api/tngis/config — what is (and is NOT) integrated. Documentation, not data. */
export function tngisConfig() {
  return {
    source: TNGIS_SOURCE,
    sourceType: TNGIS_SOURCE_TYPE,
    provenance: 'OFFICIAL_SOURCE',
    verificationStatus: 'SOURCE_VERIFIED',
    sourceCRS: SOURCE_CRS,
    officialUlpin: OFFICIAL_ULPIN_UNAVAILABLE,
    live: TNGIS.live,
    endpoints: {
      adminHierarchy: `${TNGIS.genericApi}/v2/admin_master_{district|taluk|village|survey_number}`,
      geometry: `${TNGIS.genericApi}/v1/get_geom`,
      geoserverWfs: `${TNGIS.geoserver} (WFS 2.0.0 GetFeature, typeName ${TNGIS.wfsTypeName})`,
      viewport: `GET /api/gis/tngis-parcels/bbox — WFS GetFeature bounded by BBOX(the_geom) AND district_code=${CHENNAI_DISTRICT_CODE}, capped at ${VIEWPORT_FEATURE_CAP} features, max span ${VIEWPORT_MAX_SPAN_DEG}° (Chennai-wide by viewport, never a bulk district download)`,
    },
    chennaiWide: {
      districtCode: '02',
      geoserverDistrictCode: CHENNAI_DISTRICT_CODE,
      lgdDistrictCode: '568',
      mode: 'VIEWPORT_BBOX',
      viewportMaxSpanDeg: VIEWPORT_MAX_SPAN_DEG,
      viewportFeatureCap: VIEWPORT_FEATURE_CAP,
      note: 'The map loads official parcel geometry for whatever Chennai extent is in view, progressively, from the public GeoServer WFS. It never downloads the whole ~74k-parcel district.',
    },
    integratedFields: Object.entries(PARCEL_FIELD_CLASSES)
      .filter(([, c]) => c === FIELD_CLASS.OFFICIAL_SOURCE)
      .map(([k]) => k),
    notIntegratedFields: Object.entries(PARCEL_FIELD_CLASSES)
      .filter(([, c]) => c === FIELD_CLASS.AUTHENTICATED_SOURCE)
      .map(([k]) => k),
    rateLimit: {
      minIntervalMsBetweenLiveCalls: TNGIS.minIntervalMs,
      cacheTtlMs: TNGIS.cacheTtlMs,
      note: 'Every distinct upstream call is fixture- or cache-served when possible; live calls are serialized behind a minimum interval. No bulk / area fetch exists.',
    },
    pipeline: [
      'District → Taluk → Village → Survey (generic_api admin master, +LGD codes)',
      'get_geom (generic_api/v1) → GeoJSON parcel geometry, EPSG:4326, verbatim',
      'GeoServer WFS GetFeature → sourceRecordId + LGD codes + sourceUpdatedAt',
      'normalize → tngisParcels collection (officialULPIN always null)',
      'GeoJSON layer → the ONE Chennai Cesium viewer (additive, OFF by default)',
    ],
    disclaimer: TNGIS_DISCLAIMER,
  }
}
