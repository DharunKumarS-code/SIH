export const PARCEL_ULPIN = 'TN-CHN-123456789'

// Chennai — OMR / Sholinganallur demonstration area (matches backend seed)
export const CHENNAI_BASE = { lon: 80.22705, lat: 12.90045 }

// ONE Chennai-wide Cesium environment. The area selector flies the SAME camera
// between these localities — it never swaps maps. This list mirrors the backend
// registry (`GET /api/gis/localities`) and is only the offline fallback.
export const DEFAULT_AREA_ID = 'sholinganallur'

export const LOCALITIES_FALLBACK = [
  {
    id: 'sholinganallur',
    name: 'Sholinganallur',
    label: 'Chennai · OMR / Sholinganallur',
    base: { lon: 80.22705, lat: 12.90045 },
    ulpinPrimary: 'TN-CHN-123456789',
    zone: 'Zone 15 (Sholinganallur)',
    cameraHeightM: 1500,
    extentM: 1600,
  },
  {
    id: 'adyar',
    name: 'Adyar',
    label: 'Chennai · Adyar',
    base: { lon: 80.2549, lat: 13.0059 },
    ulpinPrimary: 'TN-CHN-223456789',
    zone: 'Zone 13 (Adyar)',
    cameraHeightM: 1400,
    extentM: 1500,
  },
  {
    id: 'annanagar',
    name: 'Anna Nagar',
    label: 'Chennai · Anna Nagar',
    base: { lon: 80.2098, lat: 13.085 },
    ulpinPrimary: 'TN-CHN-323456789',
    zone: 'Zone 8 (Anna Nagar)',
    cameraHeightM: 1500,
    extentM: 1600,
  },
]

// City-overview camera target — frames every locality at once.
export const CHENNAI_CITY_VIEW = {
  lon: LOCALITIES_FALLBACK.reduce((s, l) => s + l.base.lon, 0) / LOCALITIES_FALLBACK.length,
  lat: LOCALITIES_FALLBACK.reduce((s, l) => s + l.base.lat, 0) / LOCALITIES_FALLBACK.length,
  cameraHeightM: 26000,
}

export const PROTOTYPE_ID_LABEL = 'Prototype 3D Property Identifier'

export const APP_DISCLAIMER =
  'Prototype. Land Records / Registration / Property Tax are DEMO / MOCK integrations. Spatial and record data is synthetic DEMO DATA using realistic Chennai coordinates — it represents no real parcel, building, person or government record.'
