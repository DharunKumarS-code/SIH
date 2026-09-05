// Configurable thresholds for the GNSS/CORS control-point pipeline (Phase 6).
// Every knob is overridable via an environment variable — same convention as
// backend/src/config/env.js and ai-service/app/elevation/config.py. Nothing
// here is a hidden "magic number": each threshold is named and documented.

const num = (name, def) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) ? v : def
}

export const GNSS_CONFIG = {
  // ---- coordinate sanity ----
  latMin: -90,
  latMax: 90,
  lonMin: -180,
  lonMax: 180,
  heightMinM: num('GNSS_HEIGHT_MIN_M', -500), // below the Dead Sea shoreline — anything lower is a data error
  heightMaxM: num('GNSS_HEIGHT_MAX_M', 9000), // above Everest — anything higher is a data error

  // ---- duplicates ----
  duplicateCoordToleranceM: num('GNSS_DUPLICATE_COORD_TOLERANCE_M', 0.05), // 5 cm

  // ---- accuracy plausibility (NOT inferred accuracy — only sanity-checks a supplied value) ----
  accuracyMinM: 0,
  accuracyMaxM: num('GNSS_ACCURACY_MAX_M', 100), // a "control point" claiming worse than 100 m accuracy is implausible

  // ---- robust outlier detection (median absolute deviation) ----
  // 3.5x the "robust z-score" scale factor (0.6745) is the commonly cited
  // conservative default for MAD-based outlier flagging (Iglewicz & Hoaglin).
  outlierMadK: num('GNSS_OUTLIER_MAD_K', 3.5),
  minPointsForOutlierDetection: num('GNSS_MIN_POINTS_FOR_OUTLIER', 4),

  // ---- parcel association / boundary verification ----
  // A control point within this distance of a parcel boundary is treated as
  // ambiguous (REVIEW_REQUIRED) rather than confidently MATCHED/OUTSIDE.
  boundaryToleranceM: num('GNSS_BOUNDARY_TOLERANCE_M', 1.0),
  // Radius (multiple of boundaryToleranceM) within which a parcel is even
  // considered a "candidate" for a point that is not directly inside it.
  candidateRadiusFactor: num('GNSS_CANDIDATE_RADIUS_FACTOR', 6),
}

export const PROVENANCE_SOURCES = [
  'REAL_SURVEY',
  'CORS_SURVEY',
  'UPLOADED_SURVEY',
  'DEMO',
  'RESEARCH',
  'UNVERIFIED',
  'TEST_FIXTURE',
]

// Only REAL_SURVEY / CORS_SURVEY / UPLOADED_SURVEY represent an actual survey
// observation — and even then, accuracy is only ever reported when the
// dataset itself supplied a numeric value (see validate.js). Naming a source
// "CORS" or "REAL_SURVEY" NEVER by itself implies survey-grade accuracy.
export const SURVEY_SOURCES = new Set(['REAL_SURVEY', 'CORS_SURVEY', 'UPLOADED_SURVEY'])

export const GNSS_DISCLAIMER =
  'GNSS/CORS DEMO / MODEL OUTPUT. Control-point coordinates, elevations, deviations and validation ' +
  'results are derived from uploaded, demonstration, research or survey datasets. They are not ' +
  'automatically official cadastral control points or government-authoritative survey data. GNSS/CORS ' +
  'accuracy is only reported when supported by actual supplied survey observations. Existing parcel ' +
  'geometry is never overwritten without explicit authorized review.'

export function normaliseSource(label) {
  const s = String(label || '').trim().toUpperCase()
  return PROVENANCE_SOURCES.includes(s) ? s : 'UNVERIFIED'
}
