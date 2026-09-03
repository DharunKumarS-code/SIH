// Front-end mirror of the backend land-data provenance vocabulary
// (backend/src/services/landData/provenance.js). Drives the OFFICIAL / DEMO /
// UNVERIFIED / UNAVAILABLE labelling that must appear wherever a parcel id is shown.

export const VERIFICATION = {
  OFFICIAL: 'OFFICIAL',
  DEMO: 'DEMO',
  UNVERIFIED: 'UNVERIFIED',
  UNAVAILABLE: 'UNAVAILABLE',
}

// { text, tone } — tone maps to a colour treatment in the UI.
const BADGES = {
  OFFICIAL: { text: 'Official ULPIN — Government Source', tone: 'ok', short: 'OFFICIAL' },
  DEMO: { text: 'Demo Parcel ID — Not Official ULPIN', tone: 'warn', short: 'DEMO' },
  UNVERIFIED: { text: 'Unverified — not confirmed against a government system', tone: 'warn', short: 'UNVERIFIED' },
  UNAVAILABLE: { text: 'Official data unavailable via public channels', tone: 'muted', short: 'UNAVAILABLE' },
}

export const verificationBadge = (status) => BADGES[status] || BADGES.UNVERIFIED

export const isOfficial = (status) => status === VERIFICATION.OFFICIAL

// Offline fallback used only if GET /api/land-sources is unreachable.
export const LAND_SOURCES_FALLBACK = {
  chennai: {
    status: 'UNAVAILABLE',
    summary:
      'No officially and legally accessible public API, GIS service or dataset provides real ULPIN-linked parcel data for Chennai. Every official channel requires an Aadhaar OTP, a CAPTCHA, or a registered login, which this project does not bypass. All parcels shown are DEMO data.',
  },
  ulpinSpec: {
    length: 14,
    identifies: 'land parcel',
    neverIdentifies: ['building', 'floor', 'apartment', 'unit'],
    authority: 'Department of Land Resources, Government of India',
  },
  sources: [
    { id: 'dolr-ulpin', organization: 'Department of Land Resources (Govt of India)', dataset: 'Bhu-Aadhaar / ULPIN Land Record Search', url: 'https://dolr.gov.in/en/ulpin/', accessBarrier: 'CAPTCHA per lookup; ULPIN generation needs Aadhaar OTP; no API.', chennaiAvailability: 'UNAVAILABLE' },
    { id: 'tn-tamilnilam-giviewer', organization: 'Survey & Settlement Dept, Govt of Tamil Nadu', dataset: 'Tamil Nilam — GI Viewer', url: 'https://tngis.tn.gov.in/apps/gi_viewer/', accessBarrier: 'Registered users only — login required.', chennaiAvailability: 'UNAVAILABLE' },
    { id: 'tngis-geoserver', organization: 'TNGIS, Govt of Tamil Nadu', dataset: 'TNGIS GeoServer (OGC WMS/WFS/WCS)', url: 'https://tngis.tn.gov.in/geoserver', accessBarrier: 'OGC endpoints not publicly reachable (HTTP 404).', chennaiAvailability: 'UNAVAILABLE' },
    { id: 'tn-glms', organization: 'Revenue Dept, Govt of Tamil Nadu', dataset: 'TN Government Land Management System', url: 'https://tnglms.in/', accessBarrier: 'Login required; government-land focus.', chennaiAvailability: 'UNAVAILABLE' },
    { id: 'tn-eservices', organization: 'Commissionerate of Land Administration, Govt of Tamil Nadu', dataset: 'Patta / Chitta / A-Register / FMB / TSLR extract', url: 'https://eservices.tn.gov.in/', accessBarrier: 'CAPTCHA on every extract; no API.', chennaiAvailability: 'UNAVAILABLE' },
    { id: 'data-gov-in', organization: 'Open Government Data Platform India', dataset: 'data.gov.in catalog', url: 'https://data.gov.in/', accessBarrier: 'No ULPIN-linked cadastral parcel dataset published for TN/Chennai.', chennaiAvailability: 'UNAVAILABLE' },
  ],
}
