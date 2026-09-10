// ---------------------------------------------------------------------------
// TNGIS / Tamil Nilam — provenance vocabulary for the PUBLIC-source integration.
//
// This adapter uses ONLY the publicly reachable, unauthenticated TNGIS
// endpoints (admin hierarchy + LGD codes, `generic_api/v1/get_geom`, and the
// GeoServer WMS/WFS). It NEVER touches the authenticated, encrypted `gi_mvc`
// API, so the official ULPIN / Patta / FMB attributes / G-Value / EC /
// Property-Tax / ownership are NOT available here and are reported as such.
//
// Full source discovery: docs/tngis-source-discovery.md
// ---------------------------------------------------------------------------

export const TNGIS_SOURCE = 'TNGIS_TAMIL_NILAM'
export const TNGIS_SOURCE_TYPE = 'GOVERNMENT_GIS'

/** Every TNGIS-derived parcel carries exactly this provenance block. */
export const TNGIS_PROVENANCE = Object.freeze({
  source: TNGIS_SOURCE,
  sourceType: TNGIS_SOURCE_TYPE,
  provenance: 'OFFICIAL_SOURCE',
  verificationStatus: 'SOURCE_VERIFIED',
  sourceGeometry: true,
})

// The official ULPIN is NOT exposed by any public TNGIS endpoint (the public
// GeoServer layer literally named `cadastral_ulpin` has no `ulpin` column). We
// therefore store it as null and surface this explicit sentinel in the UI —
// never a fabricated or authenticated-screen-scraped value.
export const OFFICIAL_ULPIN_UNAVAILABLE = 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE'

// Field-level provenance classes (spec section 5).
export const FIELD_CLASS = Object.freeze({
  OFFICIAL_SOURCE: 'OFFICIAL_SOURCE', // came verbatim from a public government endpoint
  AUTHENTICATED_SOURCE: 'AUTHENTICATED_SOURCE', // exists only behind the login-gated encrypted API — NOT integrated
  UNAVAILABLE: 'UNAVAILABLE', // the field exists in the model but the public source returned nothing
  UNKNOWN: 'UNKNOWN',
})

// What class each parcel field belongs to for the PUBLIC integration.
export const PARCEL_FIELD_CLASSES = Object.freeze({
  geometry: FIELD_CLASS.OFFICIAL_SOURCE,
  geometryType: FIELD_CLASS.OFFICIAL_SOURCE,
  sourceCRS: FIELD_CLASS.OFFICIAL_SOURCE,
  centroid: FIELD_CLASS.OFFICIAL_SOURCE,
  districtCode: FIELD_CLASS.OFFICIAL_SOURCE,
  lgdDistrictCode: FIELD_CLASS.OFFICIAL_SOURCE,
  talukCode: FIELD_CLASS.OFFICIAL_SOURCE,
  lgdTalukCode: FIELD_CLASS.OFFICIAL_SOURCE,
  villageCode: FIELD_CLASS.OFFICIAL_SOURCE,
  lgdVillageCode: FIELD_CLASS.OFFICIAL_SOURCE,
  surveyNumber: FIELD_CLASS.OFFICIAL_SOURCE,
  sourceRecordId: FIELD_CLASS.OFFICIAL_SOURCE,
  sourceUpdatedAt: FIELD_CLASS.OFFICIAL_SOURCE,
  subDivision: FIELD_CLASS.UNAVAILABLE, // null in the public services; shown only on the login-gated card
  officialULPIN: FIELD_CLASS.AUTHENTICATED_SOURCE, // not integrated — public source has no ULPIN
  patta: FIELD_CLASS.AUTHENTICATED_SOURCE,
  fmbAttributes: FIELD_CLASS.AUTHENTICATED_SOURCE,
  gValue: FIELD_CLASS.AUTHENTICATED_SOURCE,
  encumbrance: FIELD_CLASS.AUTHENTICATED_SOURCE,
  propertyTax: FIELD_CLASS.AUTHENTICATED_SOURCE,
  ownership: FIELD_CLASS.AUTHENTICATED_SOURCE,
  areaSqm: FIELD_CLASS.UNAVAILABLE, // `ext_ares` / `calculated_area` were null in the public WFS view
})

export const classifyField = (name) => PARCEL_FIELD_CLASSES[name] || FIELD_CLASS.UNKNOWN

export const TNGIS_DISCLAIMER =
  'Parcel geometry, administrative hierarchy and LGD codes are sourced verbatim from the ' +
  "publicly accessible Tamil Nadu GIS (TNGIS / Tamil Nilam) endpoints and are labelled OFFICIAL_SOURCE. " +
  'The official ULPIN, Patta, FMB measurement attributes, G-Value, EC, Property Tax and ownership are ' +
  'served only by the authenticated, encrypted TNGIS API and are NOT integrated — they are reported as ' +
  'unavailable from the public source, never fabricated. This project does not bypass, decrypt or ' +
  'automate the authenticated endpoints.'
