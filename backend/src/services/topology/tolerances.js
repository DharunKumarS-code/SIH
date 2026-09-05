// Centralized, explainable tolerance configuration for the topology
// validation engine (Phase 7). Every knob is environment-variable
// overridable — same convention as gnss/config.js and elevation config.
// Horizontal/vertical geometric tolerances are NOT redefined independently
// here: Phase 7 reuses Phase 2's GEOMETRY_TOLERANCE_M / Z_TOLERANCE_M /
// MIN_STOREY_M / MAX_STOREY_M directly, so a unit that already passes
// Phase 2's own containment check is never re-flagged by a differently-tuned
// Phase 7 rule.

import { GEOMETRY_TOLERANCE_M, Z_TOLERANCE_M, MIN_STOREY_M, MAX_STOREY_M } from '../geometry3d/volume.js'

const num = (name, def) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) ? v : def
}

export const TOPOLOGY_CONFIG = {
  // ---- reused from Phase 2 (never redefined independently) ----
  horizontalToleranceM: GEOMETRY_TOLERANCE_M,
  verticalToleranceM: Z_TOLERANCE_M,
  minStoreyHeightM: MIN_STOREY_M,
  maxStoreyHeightM: MAX_STOREY_M,

  // ---- footprint overlap ----
  overlapAreaTolM2: num('TOPOLOGY_OVERLAP_AREA_TOL_M2', 1.0), // ignore slivers below this
  duplicateIouThreshold: num('TOPOLOGY_DUPLICATE_IOU', 0.9), // near-identical footprint
  candidateRadiusM: num('TOPOLOGY_CANDIDATE_RADIUS_M', 60), // bbox-prefilter radius for pairwise checks

  // ---- parcel gap classification (spec: not every gap is an error) ----
  // Bands, in order: [0, horizontalToleranceM] -> touching, not a gap at all;
  // (horizontalToleranceM, gapErrorMaxM] -> ERROR (a defect: two parcels this
  // close were almost certainly meant to share a boundary); (gapErrorMaxM,
  // gapWarnMaxM] -> WARNING; (gapWarnMaxM, gapCandidateRadiusM] -> no finding
  // (INFO-equivalent: plausibly an intentional road/setback). gapErrorMaxM
  // MUST stay above horizontalToleranceM or the ERROR band is empty.
  gapErrorMaxM: num('TOPOLOGY_GAP_ERROR_MAX_M', 1.0),
  gapWarnMaxM: num('TOPOLOGY_GAP_WARN_MAX_M', 2.0),
  gapCandidateRadiusM: num('TOPOLOGY_GAP_CANDIDATE_RADIUS_M', 10), // beyond this, treated as INFO (likely a road/setback)

  // ---- degenerate-geometry minimums ----
  minAreaM2: num('TOPOLOGY_MIN_AREA_M2', 1.0),
  minVolumeM3: num('TOPOLOGY_MIN_VOLUME_M3', 1.0),
  minHeightM: num('TOPOLOGY_MIN_HEIGHT_M', 0.1),
  maxHeightM: num('TOPOLOGY_MAX_HEIGHT_M', 500), // taller than this is implausible for this demo dataset

  // ---- declared vs geometry-derived area mismatch ----
  areaMismatchFactor: num('TOPOLOGY_AREA_MISMATCH_FACTOR', 0.25), // parcels: > 25% difference is flagged
  // Units get a much looser tolerance than parcels: this demo's unit
  // footprints (data/geo.js::gridCells) are deliberately inset ~8% per side
  // purely so adjacent units render as visually separate boxes — a rendering
  // choice, not a true-to-scale footprint — which alone shrinks geometry
  // area to ~70% of the un-inset cell, before built-up-vs-carpet-area's own
  // normal ~15-20% markup is even considered. A tight tolerance here would
  // flag most of the (correct) demo dataset; this only catches genuinely
  // gross mismatches (e.g. an order-of-magnitude data-entry error).
  unitAreaMismatchFactor: num('TOPOLOGY_UNIT_AREA_MISMATCH_FACTOR', 2.5),

  // ---- vertical stacking / continuity ----
  stackingGapWarnM: num('TOPOLOGY_STACKING_GAP_WARN_M', 0.5), // unexplained vertical gap between floors
  stackingGapErrorM: num('TOPOLOGY_STACKING_GAP_ERROR_M', 3.0), // gap large enough to look like an omitted floor

  // ---- disconnection ----
  disconnectionRadiusM: num('TOPOLOGY_DISCONNECTION_RADIUS_M', 5), // beyond containment tolerance, "outside" becomes "disconnected"

  // ---- batching / perf ----
  maxGeometryBatch: num('TOPOLOGY_MAX_GEOMETRY_BATCH', 500),
}

export const TOPOLOGY_DISCLAIMER =
  'RULE_ENGINE / DETERMINISTIC_VALIDATION output (Phase 7). Findings are produced by deterministic ' +
  'geometry rules — not AI/ML — against the existing prototype/DEMO parcel, building, floor, unit and ' +
  '3D-volume geometry. A finding never changes stored geometry; any suggestedFix is guidance for a ' +
  'separate, explicit review action. Underlying data provenance (DEMO/OFFICIAL/AI_DEMO/etc.) is ' +
  'preserved and never upgraded by a validation result.'

// Phase 7 uses deterministic topology validation rules. ML anomaly detection
// is not enabled because explainable geometric rules are the appropriate
// primary validation mechanism for cadastral and 3D topology validation.
export const ML_DECISION_NOTE =
  'Phase 7 uses deterministic topology validation rules. ML anomaly detection is not enabled because ' +
  'explainable geometric rules are the appropriate primary validation mechanism for cadastral and 3D ' +
  'topology validation.'
