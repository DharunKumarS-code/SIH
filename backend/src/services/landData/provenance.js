// ---------------------------------------------------------------------------
// Land-data provenance vocabulary + the register of OFFICIAL sources that were
// investigated for real ULPIN parcel data (Phase 1).
//
// Full write-up: docs/13-official-ulpin-data-investigation.md
// ---------------------------------------------------------------------------

/** How trustworthy a parcel record is. */
export const VERIFICATION_STATUS = {
  OFFICIAL: 'OFFICIAL', // sourced from an authoritative government system
  DEMO: 'DEMO', // synthetic prototype data
  UNVERIFIED: 'UNVERIFIED', // real-looking but not confirmed against an official system
  UNAVAILABLE: 'UNAVAILABLE', // official data exists but is not accessible to this app
}

/** What kind of identifier the `ulpin` field actually holds. */
export const ULPIN_STATUS = {
  OFFICIAL: 'OFFICIAL', // a real 14-digit Government of India ULPIN
  DEMO_NOT_OFFICIAL: 'DEMO_NOT_OFFICIAL', // a synthetic prototype parcel id, NOT a ULPIN
  UNVERIFIED: 'UNVERIFIED',
  UNAVAILABLE: 'UNAVAILABLE',
}

// ULPIN facts (Department of Land Resources, dolr.gov.in/en/ulpin/):
//   - 14-digit alphanumeric, ECCMA standard, derived from parcel lat/long
//   - identifies a LAND PARCEL only — never a building, floor or apartment
//   - Tamil Nadu is part of the national rollout
export const ULPIN_SPEC = {
  length: 14,
  format: 'alphanumeric',
  standard: 'ECCMA (geo-referenced)',
  identifies: 'land parcel',
  neverIdentifies: ['building', 'floor', 'apartment', 'unit'],
  authority: 'Department of Land Resources, Ministry of Rural Development, Government of India',
}

// Sources investigated for real, legally accessible ULPIN parcel data.
// `chennaiAvailability` is the bottom line for THIS project's target areas.
export const OFFICIAL_SOURCES = [
  {
    id: 'dolr-ulpin',
    organization: 'Department of Land Resources (DoLR), Ministry of Rural Development, Govt of India',
    dataset: 'Bhu-Aadhaar / ULPIN Land Record Search',
    url: 'https://dolr.gov.in/en/ulpin/',
    covers: 'ULPIN Record of Rights lookup, nation-wide (DILRMP)',
    access: 'Web portal, single-record lookup only',
    accessBarrier: 'CAPTCHA per lookup; ULPIN generation requires an Aadhaar-linked mobile OTP. No public API, no bulk download.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Authoritative for ULPIN, but nothing machine-readable is exposed without clearing a CAPTCHA / OTP.',
  },
  {
    id: 'tn-tamilnilam-giviewer',
    organization: 'Survey & Settlement Department / TNeGA, Government of Tamil Nadu',
    dataset: 'Tamil Nilam — GI Viewer (survey boundaries, patta, FMB)',
    url: 'https://tngis.tn.gov.in/apps/gi_viewer/',
    covers: 'Tamil Nadu cadastral parcels, survey number, sub-division, patta, FMB',
    access: 'Web application',
    accessBarrier: 'Available exclusively to registered users — login required.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Richest TN parcel data, but gated behind account registration/login.',
  },
  {
    id: 'tngis-geoserver',
    organization: 'Tamil Nadu Geographical Information System (TNGIS), Govt of Tamil Nadu',
    dataset: 'TNGIS GeoServer (OGC WMS / WFS / WCS)',
    url: 'https://tngis.tn.gov.in/geoserver',
    covers: 'Spatial layers for Tamil Nadu (state GIS)',
    access: 'OGC services',
    accessBarrier: 'OGC endpoints (/geoserver/ows, /geoserver/wfs) are not reachable from the public internet (HTTP 404); appears restricted to internal / registered use.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Standards-based and would be ideal, but not publicly exposed.',
  },
  {
    id: 'tn-glms',
    organization: 'Revenue Department, Government of Tamil Nadu',
    dataset: 'Tamil Nadu Government Land Management System (TNGLMS)',
    url: 'https://tnglms.in/',
    covers: 'Government-land inventory, cadastral maps, RoR, building & tax linkage',
    access: 'Web portal',
    accessBarrier: 'Login required; scope is primarily government land, not private parcels.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Not private-parcel oriented and gated behind login.',
  },
  {
    id: 'tn-eservices',
    organization: 'Commissionerate of Land Administration, Government of Tamil Nadu',
    dataset: 'Land Record e-Services — Patta / Chitta / A-Register / FMB / TSLR extract',
    url: 'https://eservices.tn.gov.in/',
    covers: 'Tamil Nadu land records by District / Taluk / Village / Survey No / Sub-Division (urban parcels use the Town Survey Land Register)',
    access: 'HTML form lookups',
    accessBarrier: 'CAPTCHA on every extract; no API, no machine-readable output, no bulk export.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Chennai urban land is under Town Survey / TSLR here — still CAPTCHA-gated per record.',
  },
  {
    id: 'data-gov-in',
    organization: 'Open Government Data (OGD) Platform India',
    dataset: 'data.gov.in catalog',
    url: 'https://data.gov.in/',
    covers: 'Open datasets, all sectors',
    access: 'Open / API',
    accessBarrier: 'No cadastral parcel-boundary dataset with ULPIN for Tamil Nadu / Chennai is published.',
    chennaiAvailability: 'UNAVAILABLE',
    notes: 'Only administrative / village-level boundaries exist, not ULPIN-linked parcels.',
  },
]

// One-line summary for the whole project target.
export const CHENNAI_ULPIN_AVAILABILITY = {
  status: 'UNAVAILABLE',
  targetAreas: ['Sholinganallur', 'Adyar', 'Anna Nagar'],
  summary:
    'No officially and legally accessible public API, GIS service or dataset provides real ULPIN-linked parcel geometry for Chennai. Every accessible official channel requires clearing an Aadhaar OTP, a CAPTCHA, or a registered-user login — all of which this project must not bypass. All parcels the app shows are therefore DEMO data, explicitly labelled as such.',
  adminHierarchy:
    'Government of India / Tamil Nadu land-parcel key: District → Taluk → Village (Town Survey block for urban land) → Survey Number → Sub-Division Number. In Chennai, Sholinganallur and Anna Nagar are taluks; Adyar is a neighbourhood in Mylapore taluk. Chennai urban parcels are recorded in the Town Survey Land Register (TSLR), not the village Patta/FMB register.',
  investigatedOn: '2026-09-03',
}
