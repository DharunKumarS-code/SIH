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

// Chennai coverage regions — navigation presets for the ONE Cesium camera.
// They only move the camera; the TNGIS viewport loader then streams official
// parcels for whatever comes into view. Centres are approximate.
export const CHENNAI_REGIONS = [
  { id: 'north', name: 'North Chennai', lon: 80.2860, lat: 13.1250, height: 12000 },
  { id: 'central', name: 'Central Chennai', lon: 80.2600, lat: 13.0600, height: 11000 },
  { id: 'south', name: 'South Chennai', lon: 80.2350, lat: 12.9450, height: 13000 },
  { id: 'omr', name: 'OMR / Sholinganallur', lon: 80.2270, lat: 12.9004, height: 9000 },
]

// City-overview camera target — frames every locality at once.
export const CHENNAI_CITY_VIEW = {
  lon: LOCALITIES_FALLBACK.reduce((s, l) => s + l.base.lon, 0) / LOCALITIES_FALLBACK.length,
  lat: LOCALITIES_FALLBACK.reduce((s, l) => s + l.base.lat, 0) / LOCALITIES_FALLBACK.length,
  cameraHeightM: 26000,
}

// ---------------------------------------------------------------------------
// Coimbatore — ONE demonstration property, deliberately isolated from the
// Chennai locality registry above. It is not fetched from the backend/TNGIS
// pipeline and never mixes into `localities`/`CHENNAI_REGIONS`; it exists so
// the user-provided ODM textured reconstruction has a real place to open from
// in the SAME Cesium viewer. Unlike every Chennai property in this prototype,
// this ONE property carries a real official ULPIN and land-record fields the
// user supplied (see backend/src/data/seed.js, buildingId
// 'COIMBATORE-DEMO-001', which is the server-side source of truth these
// mirror for the client-only "coimbatore-demo" selection mode) — the 3D
// reconstruction itself (geometry/volume/height) remains a synthetic ODM
// capture, never presented as a surveyed cadastral volume.
// ---------------------------------------------------------------------------
export const COIMBATORE_DEMO_PROPERTY = {
  id: 'coimbatore-demo',
  propertyId: 'COIMBATORE-DEMO-001',
  name: 'Coimbatore Kuniyamuthur',
  lat: 10.943404,
  lon: 76.956549,
  dms: '10°56\'36.3"N 76°57\'23.6"E',
  plusCode: 'WXV4+9J7 Coimbatore, Tamil Nadu',
  location: 'Coimbatore, Tamil Nadu',
  ulpin: '72TEYHD9TSKCH0',
  district: 'Coimbatore',
  districtTamil: 'கோயம்புத்தூர்',
  taluk: 'Perur',
  talukTamil: 'பேரூர்',
  village: 'Kuniamuthur',
  villageTamil: 'குனியமுத்தூர்',
  villageLgdCode: '932292',
  surveyNumber: '61N',
  subdivisionNumber: '11',
  officialCentroid: { lat: 10.942593, lon: 76.956652 },
  threeDSource: 'User-provided ODM textured model',
  modelType: 'ODM 2.5D textured reconstruction',
  // Describes the 3D reconstruction only (photogrammetry capture, not
  // surveyed) — kept separate from the official land-record fields above,
  // which are independently verified. Never conflate the two: see
  // CoimbatoreDemoCard, which renders a distinct "Official ULPIN" badge.
  verification: 'DEMO',
  status: 'Demonstration',
}

// The ODM archive's OBJ/MTL are in the reconstruction's own local, Z-up,
// unscaled metres — there is no embedded absolute CRS (see
// odm_textured_model_geo.conf). COIMBATORE_MODEL_TRANSFORM is the explicit,
// deterministic mapping from that local mesh space to the Three.js walkthrough
// scene; it does NOT reproject the mesh into geographic space, it only
// documents how the local frame relates to COIMBATORE_DEMO_PROPERTY's
// lat/lon anchor above. Bounding box measured directly from
// odm_textured_model_geo.obj: X [-10.104, 0.866], Y [-9.822, 5.958],
// Z [-3.956, 2.728] (metres, source Z-up).
export const COIMBATORE_MODEL_TRANSFORM = {
  anchor: { lat: 10.943404, lon: 76.956549 },
  sourceUpAxis: 'Z',
  // Three.js is Y-up; rotating -90° about X maps source (x, y, z) -> scene
  // (x, z, -y), i.e. the source's vertical axis (Z) becomes the scene's Y.
  rotationEulerXYZ: [-Math.PI / 2, 0, 0],
  // Footprint (source X/Y) centred on the origin; source Z shifted so the
  // model's lowest point rests on scene y = 0 (ground plane).
  translation: {
    sourceXCenter: (-10.104058 + 0.865942) / 2,
    sourceYCenter: (-9.821918 + 5.958082) / 2,
    sourceZFloor: -3.955478,
  },
  // ODM's dense reconstruction already outputs metric units; no independent
  // ground-control-point scale check was available for this archive, so scale
  // is left at 1:1 (documented assumption, not a verified survey scale).
  scale: 1,
}

// Interior mode — the reference grd-floor-viewer repository's own Scaniverse
// capture (Scaniverse_2026_09_14_180438.obj/.mtl/.jpg, already cloned at
// build/audit time; copied into frontend/public/models/coimbatore-demo/interior/
// unmodified). This is a REAL scanned interior, not a procedural/placeholder
// room. Its OBJ header embeds the capture's own metadata:
//   Latitude 10.9432985, Longitude 76.9564015, Elevation 412.49274m,
//   Rotation 159.2062deg, Unit: meter
// — within ~15m of COIMBATORE_DEMO_PROPERTY's anchor (10.943404, 76.956549),
// corroborating this as the same property's interior. It does NOT, however,
// share a local origin, scale or rotation convention with the ODM exterior
// model (which has no embedded CRS at all — see COIMBATORE_MODEL_TRANSFORM
// above). Per spec, the two are deliberately kept as two independently
// self-consistent local scenes tied to the SAME documented real-world
// anchor, never reprojected into one shared frame.
//
// Unlike the ODM (Z-up), this Scaniverse/ARKit capture is already Y-up —
// Three.js's own convention — so no axis rotation is needed. Bounding box
// measured directly from Scaniverse_2026_09_14_180438.obj (269,947 faces /
// 145,953 vertices): X [-3.8122, 3.5118], Y [-0.3340, 3.1599],
// Z [-6.6917, 7.1963] (metres).
export const COIMBATORE_INTERIOR_TRANSFORM = {
  anchor: { lat: 10.943404, lon: 76.956549 },
  sourceUpAxis: 'Y',
  rotationEulerXYZ: [0, 0, 0],
  // Footprint (source X/Z) centred on the origin; source Y shifted so the
  // model's lowest point rests on scene y = 0 (floor plane).
  translation: {
    sourceXCenter: (-3.8122 + 3.5118) / 2,
    sourceYFloor: -0.334,
    sourceZCenter: (-6.6917 + 7.1963) / 2,
  },
  // Scaniverse's "Unit: meter" header confirms metric output; no independent
  // scale verification was available, so scale is left at 1:1 (documented
  // assumption, not a verified survey scale — same caveat as the exterior).
  scale: 1,
}

// ---------------------------------------------------------------------------
// Exterior "environment" staging — ground/road context, an illustrative
// cadastral parcel volume, illustrative (not surveyed) underground utility
// routing, and orbit-camera presets, added AROUND the real ODM model above
// (COIMBATORE_MODEL_TRANSFORM). Modelled on the scene composition of the same
// author's public demo for this property,
// https://snihaal2006.github.io/3D-ULPIN-Cadastre/, reproduced with this
// project's own Three.js geometry/loaders rather than importing that repo's
// assets — its final.obj/.mtl texture paths
// (vertical-cadastre/data/outputs/photogrammetry/job_233d755c/odm_texturing/...)
// show it is the same ODM capture already used here, so there is nothing to
// import, only the surrounding scene to reproduce.
//
// All positions below are FRACTIONS of the loaded model's own measured
// bounding box (half-extent in X/Z, full extent in Y from the ground) rather
// than absolute metres, so the environment always stays proportionate to
// whatever the actual mesh measures at load time. Every value is
// illustrative/DEMO — never presented as a surveyed cadastral boundary or a
// surveyed utility layout, matching COIMBATORE_DEMO_PROPERTY's existing "no
// official ULPIN, no survey record" stance. Diameters/materials/operator
// names (which WOULD look like a real utility record) are deliberately not
// reproduced from the reference — only generic labelled routing.
// ---------------------------------------------------------------------------
export const COIMBATORE_EXTERIOR_UTILITIES = [
  { id: 'water', label: 'Illustrative water supply line (not surveyed)', color: 0x00b4d8, depthFrac: 0.5, offsetFrac: 1.35 },
  { id: 'sewer', label: 'Illustrative sewer line (not surveyed)', color: 0xe76f51, depthFrac: 0.85, offsetFrac: 1.6 },
  { id: 'storm', label: 'Illustrative stormwater drain (not surveyed)', color: 0x2a9d8f, depthFrac: 0.3, offsetFrac: 1.15 },
  { id: 'power', label: 'Illustrative electric/telecom duct (not surveyed)', color: 0xe9c46a, depthFrac: 0.25, offsetFrac: 1.8 },
]

// Camera presets for the exterior's orbit camera — [x, y, z] each a fraction
// of (model half-width, model height above ground, model half-depth) added
// to the model's own centre. `target` likewise. Mirrors the reference's
// "Front Gate / Street Angle / Aerial / Top Ortho" preset set.
export const COIMBATORE_CAMERA_PRESETS = {
  front: { label: 'Front Gate', posFrac: [0, 0.9, 2.2], targetFrac: [0, 0.45, 0] },
  street: { label: 'Street Angle', posFrac: [-1.7, 1.1, 2.0], targetFrac: [0, 0.45, 0.3] },
  aerial: { label: 'Aerial', posFrac: [0.2, 3.4, 2.2], targetFrac: [0, 0.3, 0] },
  top: { label: 'Top Ortho', posFrac: [0, 5.5, 0.02], targetFrac: [0, 0, 0] },
}

export const PROTOTYPE_ID_LABEL = 'Prototype 3D Property Identifier'

export const APP_DISCLAIMER =
  'Prototype. Land Records / Registration / Property Tax are DEMO / MOCK integrations. Spatial and record data is synthetic DEMO DATA using realistic Chennai coordinates — it represents no real parcel, building, person or government record.'
