// Status/severity model for the topology validation engine (Phase 7).
// STATUS describes a finding's disposition; SEVERITY describes its
// importance. The two are never conflated (e.g. status=ERROR, severity=HIGH
// is a perfectly normal combination — see the spec's own example).

export const STATUS = { VALID: 'VALID', WARNING: 'WARNING', ERROR: 'ERROR', REVIEW_REQUIRED: 'REVIEW_REQUIRED' }
export const SEVERITY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' }

const STATUS_RANK = { VALID: 0, WARNING: 1, REVIEW_REQUIRED: 2, ERROR: 3 }
export const worstStatus = (a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a)

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }
export const worstSeverity = (a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a)

// Default status/severity per rule id. A rule can still override per-instance
// (e.g. a gap's severity depends on how small the gap actually is) — this is
// only the starting point / documentation of intent.
//
// Some spec-listed rule ids describe the SAME underlying geometric check as a
// more specific one used elsewhere in this engine (e.g. the "Hierarchy"
// section's BUILDING_NOT_IN_PARCEL is the same check as the "Building
// Validation" section's BUILDING_OUTSIDE_PARCEL). Rather than emit duplicate
// findings for one real defect, the engine emits ONE finding under the more
// specific canonical id and lists every other spec name as `aliases` on that
// finding — every literal rule id from the spec is still filterable/findable,
// there are just no duplicate findings. See docs/19 section 4 for the full
// cross-reference table.
export const RULE_DEFAULTS = {
  // ---- parcel ----
  SELF_INTERSECTION: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_POLYGON: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  OVERLAPPING_PARCELS: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  GAPS: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  DUPLICATE_PARCEL_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  EMPTY_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.CRITICAL },
  INVALID_AREA: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },

  // ---- building ----
  BUILDING_OUTSIDE_PARCEL: { status: STATUS.ERROR, severity: SEVERITY.HIGH }, // alias: BUILDING_NOT_IN_PARCEL
  BUILDING_CROSSES_PARCEL_BOUNDARY: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  BUILDING_OVERLAP: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_BUILDING_FOOTPRINT: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  SELF_INTERSECTING_BUILDING: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  DUPLICATE_BUILDING: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  EMPTY_BUILDING_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.CRITICAL },
  INVALID_BUILDING_AREA: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },

  // ---- floor ----
  INVALID_FLOOR_ELEVATION: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INCORRECT_STACKING: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  FLOOR_OVERLAP: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE: { status: STATUS.ERROR, severity: SEVERITY.HIGH }, // alias: PARENT_CONTAINMENT (floor/building)
  DUPLICATE_FLOOR: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_FLOOR_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  FLOOR_NOT_IN_BUILDING: { status: STATUS.ERROR, severity: SEVERITY.HIGH },

  // ---- unit ----
  UNIT_OVERLAP: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  UNIT_OUTSIDE_BUILDING: { status: STATUS.ERROR, severity: SEVERITY.HIGH }, // alias: UNIT_NOT_IN_BUILDING
  UNIT_OUTSIDE_FLOOR: { status: STATUS.ERROR, severity: SEVERITY.HIGH }, // alias: UNIT_NOT_IN_FLOOR, PARENT_CONTAINMENT (unit/floor)
  INVALID_UNIT_VOLUME: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_Z_RANGE: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  DUPLICATE_UNIT: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  UNIT_VERTICAL_OVERLAP: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM }, // alias: VOLUME_INTERSECTION (unit/unit)
  UNIT_DISCONNECTED: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM }, // alias: DISCONNECTED_GEOMETRY (unit)
  INVALID_UNIT_AREA: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },

  // ---- 3D volume ----
  ZERO_OR_NEGATIVE_VOLUME: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  VOLUME_INTERSECTION: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  DUPLICATE_VOLUME: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  DISCONNECTED_GEOMETRY: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  INVALID_X_RANGE: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_Y_RANGE: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INVALID_HEIGHT: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  Z_CONTINUITY: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },

  // ---- engine-level ----
  GEOMETRY_ENGINE_UNAVAILABLE: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.LOW },
}

/** Every spec rule name that is folded into a more specific canonical id (see RULE_DEFAULTS comment). */
export const RULE_ALIASES = {
  BUILDING_OUTSIDE_PARCEL: ['BUILDING_NOT_IN_PARCEL'],
  UNIT_OUTSIDE_BUILDING: ['UNIT_NOT_IN_BUILDING'],
  UNIT_OUTSIDE_FLOOR: ['UNIT_NOT_IN_FLOOR', 'PARENT_CONTAINMENT'],
  FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE: ['PARENT_CONTAINMENT'],
  UNIT_DISCONNECTED: ['DISCONNECTED_GEOMETRY'],
  UNIT_VERTICAL_OVERLAP: ['VOLUME_INTERSECTION'],
  INCORRECT_STACKING: ['Z_CONTINUITY'],
}

export function defaultsFor(ruleId) {
  return RULE_DEFAULTS[ruleId] || { status: STATUS.WARNING, severity: SEVERITY.MEDIUM }
}

/** Does `ruleId` match a requested filter, either directly or via its aliases? */
export function ruleMatches(ruleId, wanted) {
  if (!wanted) return true
  if (ruleId === wanted) return true
  return (RULE_ALIASES[ruleId] || []).includes(wanted)
}
