// Phase 8 — underground 3D infrastructure mapping. Configurable thresholds,
// controlled vocabularies and the non-negotiable provenance model.
//
// Every knob is environment-variable overridable — same convention as
// backend/src/services/gnss/config.js and topology/tolerances.js. Nothing here
// is a hidden "magic number".
//
// PROVENANCE IS NON-NEGOTIABLE (spec section 4): a source is NEVER automatically
// promoted to official. DEMO / RESEARCH / UNVERIFIED / UPLOADED_SURVEY can never
// become OFFICIAL/AUTHORIZED without an explicit authorized review action.

const num = (name, def) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) ? v : def
}

export const UNDERGROUND_CONFIG = {
  // ---- coordinate sanity (WGS84 degrees) ----
  latMin: -90,
  latMax: 90,
  lonMin: -180,
  lonMax: 180,

  // ---- project extent (Chennai demo localities) ----
  // A point/vertex further than this (metres) from ANY known locality centre is
  // outside the project area — flagged, never silently relocated.
  projectAreaRadiusM: num('INF_PROJECT_AREA_RADIUS_M', 3500),

  // ---- dimensions plausibility ----
  minDiameterM: num('INF_MIN_DIAMETER_M', 0.01),
  maxDiameterM: num('INF_MAX_DIAMETER_M', 8), // a >8 m "pipe" is almost certainly a data error (a tunnel is a TUNNEL, not a pipeline)
  minDimensionM: num('INF_MIN_DIMENSION_M', 0.01),
  maxDimensionM: num('INF_MAX_DIMENSION_M', 30),

  // ---- depth / vertical plausibility ----
  // Absolute depth-below-surface sanity: below this is implausible for the demo
  // dataset (deep-bored metro in Chennai bottoms out well above 60 m).
  maxDepthBelowSurfaceM: num('INF_MAX_DEPTH_BELOW_SURFACE_M', 60),
  // A positive "depthBelowSurface" that would put the crown of the asset ABOVE
  // the stated surface elevation is a DEPTH_SURFACE_CONFLICT.
  depthSurfaceToleranceM: num('INF_DEPTH_SURFACE_TOLERANCE_M', 0.05),

  // ---- geometry degeneracy ----
  minSegmentLengthM: num('INF_MIN_SEGMENT_LENGTH_M', 0.25), // linear infra shorter than this is degenerate
  minChamberAreaM2: num('INF_MIN_CHAMBER_AREA_M2', 0.25),

  // ---- duplicate detection ----
  duplicateVertexToleranceM: num('INF_DUPLICATE_VERTEX_TOLERANCE_M', 0.25),

  // ---- 3D intersection / clearance (spec sections 19-20) ----
  // Two linear assets whose 2D projections cross are a "2D_INTERSECTION". They
  // are only a "3D_COLLISION" when their vertical [bottom,top] bands also
  // overlap (within this tolerance). We do NOT invent an engineering clearance
  // threshold — a measured vertical separation is reported as-is, and
  // clearanceStatus is REVIEW_REQUIRED unless an authoritative rule is configured.
  collisionVerticalToleranceM: num('INF_COLLISION_VERTICAL_TOLERANCE_M', 0.0),
  // Proximity threshold (metres) below which a measured vertical separation
  // between two crossing assets is surfaced as REVIEW_REQUIRED. This is NOT an
  // engineering clearance standard — it only decides which measured separations
  // are close enough to be worth a human's attention. Every separation, near or
  // far, is still reported as a number on the crossing finding.
  clearanceNoticeM: num('INF_CLEARANCE_NOTICE_M', 0.6),
  // Optional authoritative minimum-clearance rule. Unset (null) => no clearance
  // verdict is ever issued, only the measured separation + REVIEW_REQUIRED.
  authoritativeClearanceM: (() => {
    const v = Number(process.env.INF_AUTHORITATIVE_CLEARANCE_M)
    return Number.isFinite(v) ? v : null
  })(),

  // ---- parcel / building spatial association ----
  nearParcelToleranceM: num('INF_NEAR_PARCEL_TOLERANCE_M', 3.0),
  nearBuildingToleranceM: num('INF_NEAR_BUILDING_TOLERANCE_M', 3.0),

  // ---- batching ----
  maxUploadFeatures: num('INF_MAX_UPLOAD_FEATURES', 5000),
}

// ---------------------------------------------------------------------------
// Controlled infrastructure type list (spec section 6). Do NOT create
// uncontrolled arbitrary types when an existing type applies — an unrecognised
// value normalises to OTHER and is flagged for review.
// ---------------------------------------------------------------------------
export const INFRA_TYPES = [
  'WATER_PIPELINE',
  'SEWER_PIPELINE',
  'STORMWATER_DRAIN',
  'ELECTRICAL',
  'TELECOM',
  'GAS',
  'TUNNEL',
  'METRO',
  'UTILITY_DUCT',
  'MANHOLE',
  'CHAMBER',
  'OTHER',
]

// Which GeoJSON geometry a type is normally supplied as. Used only to raise a
// WARNING on a mismatch — never to reject or silently coerce.
export const LINEAR_TYPES = new Set([
  'WATER_PIPELINE', 'SEWER_PIPELINE', 'STORMWATER_DRAIN', 'ELECTRICAL',
  'TELECOM', 'GAS', 'TUNNEL', 'METRO', 'UTILITY_DUCT',
])
export const POINT_TYPES = new Set(['MANHOLE'])
export const VOLUMETRIC_TYPES = new Set(['CHAMBER', 'TUNNEL', 'METRO'])

// Types that carry a circular cross-section (diameter). Rectangular drains /
// tunnels carry width + height instead.
export const DIAMETER_TYPES = new Set(['WATER_PIPELINE', 'SEWER_PIPELINE', 'ELECTRICAL', 'TELECOM', 'GAS', 'UTILITY_DUCT'])
export const RECT_TYPES = new Set(['STORMWATER_DRAIN', 'TUNNEL', 'METRO', 'CHAMBER'])

export function normaliseType(label) {
  const s = String(label || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return INFRA_TYPES.includes(s) ? s : 'OTHER'
}

// ---------------------------------------------------------------------------
// Provenance model (spec section 4). Classifications, and the rule that a
// source is NEVER auto-promoted.
// ---------------------------------------------------------------------------
export const PROVENANCE_SOURCES = [
  'OFFICIAL',
  'AUTHORIZED',
  'REAL_SURVEY',
  'UPLOADED_SURVEY',
  'DEMO',
  'RESEARCH',
  'UNVERIFIED',
  'UNAVAILABLE',
]

// Only these represent an actual authoritative dataset. Everything else is a
// candidate / demonstration / research record and is NEVER shown as official.
export const OFFICIAL_SOURCES = new Set(['OFFICIAL', 'AUTHORIZED'])

// Sources that must NEVER be automatically promoted to official (spec section 4).
export const NEVER_AUTO_PROMOTE = new Set(['DEMO', 'RESEARCH', 'UNVERIFIED', 'UPLOADED_SURVEY'])

export function normaliseSource(label) {
  const s = String(label || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return PROVENANCE_SOURCES.includes(s) ? s : 'UNVERIFIED'
}

/**
 * Derive verificationStatus + isOfficial from a source WITHOUT ever promoting.
 * verificationStatus mirrors the source classification exactly; isOfficial is
 * true only for OFFICIAL / AUTHORIZED. An explicit, authorized review action is
 * the ONLY way a record's verificationStatus can change afterwards (and even
 * then this module never rewrites `source`).
 */
export function deriveVerification(source) {
  const s = normaliseSource(source)
  return { source: s, verificationStatus: s, isOfficial: OFFICIAL_SOURCES.has(s) }
}

// Legal ownership is a SEPARATE concept from spatial relationship and from
// ownerAuthority (spec section 11). It is only ever populated from authoritative
// data; otherwise it is NOT_PROVIDED. Spatial intersection NEVER establishes it.
export const LEGAL_OWNERSHIP_NOT_PROVIDED = 'NOT_PROVIDED'

// Spatial relationship vocabulary (spec section 12). These are geometry facts
// only and are NEVER converted into a legal ownership claim.
export const SPATIAL_RELATIONS = [
  'WITHIN_PARCEL', 'CROSSES_PARCEL', 'NEAR_PARCEL', 'OUTSIDE_PROJECT_AREA',
  'UNDER_BUILDING', 'NEAR_BUILDING', 'CROSSES_BUILDING',
  'INTERSECTS_UTILITY', 'PARALLEL_TO_UTILITY',
]

// Vertical reference vocabulary (spec sections 8-9, 16).
export const DEPTH_REFERENCES = ['GROUND_SURFACE', 'PARCEL_SURFACE', 'TERRAIN', 'ABSOLUTE', 'UNKNOWN']
export const VERTICAL_STATUS = ['KNOWN', 'DERIVED', 'DEMO', 'UNKNOWN']

export const UNDERGROUND_DISCLAIMER =
  'UNDERGROUND INFRASTRUCTURE DATA. Infrastructure geometry, depth, elevation, ownership/authority and ' +
  'status are displayed only from available official, authorized, uploaded, research or demonstration ' +
  'datasets. Spatial intersection does not establish legal ownership. Underground depth/elevation is ' +
  'only reported when supported by source data. Demonstration data is clearly labelled DEMO and is not ' +
  'authoritative Chennai utility infrastructure.'

// Phase 8 uses the existing deterministic validation approach (Phase 7 result
// model, Phase 6 CRS handling, Phase 5 elevation). No ML model is used or implied.
export const ML_DECISION_NOTE =
  'Phase 8 underground infrastructure validation uses deterministic geometry and provenance rules — ' +
  'not AI/ML. 3D intersection, vertical separation and CRS/vertical-datum handling are explicit, ' +
  'explainable computations, which is the appropriate mechanism for cadastral and utility topology.'
