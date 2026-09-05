// Deterministic floor rules (Phase 7, RULE_ENGINE). Floors in this data
// model have no independent footprint geometry — a floor's horizontal
// extent is always its parent building's own footprint (Phase 2's
// `floorVolume(f, building)`), so FLOOR_NOT_IN_BUILDING is a structural
// guarantee here rather than something that can meaningfully fail; it is
// still implemented (and tested) so the rule exists for a future data model
// where a floor might carry its own geometry override.

import { MIN_STOREY_M, MAX_STOREY_M, Z_TOLERANCE_M } from '../../geometry3d/volume.js'
import { makeFinding } from '../result.js'
import { STATUS, SEVERITY } from '../severity.js'
import { TOPOLOGY_CONFIG } from '../tolerances.js'

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const fid = (f) => f.floorSegment || f.floorId
const focusRef = (f) => ({ kind: 'floor', buildingId: f.buildingId, floorNumber: f.floorNumber, ulpin: f.ulpin })

/** Rules: INVALID_FLOOR_GEOMETRY, INVALID_FLOOR_ELEVATION. */
export function validateFloorElevation(floors, buildingsById) {
  const findings = []
  for (const f of floors) {
    const building = buildingsById.get(f.buildingId)
    if (!building?.geometry) {
      findings.push(makeFinding({
        ruleId: 'INVALID_FLOOR_GEOMETRY', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)} has no parent building footprint to derive its 3D volume from.`,
        suggestedFix: 'Ensure the parent building has a valid footprint before validating its floors.',
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
      continue
    }

    if (!finite(f.baseHeight) || !finite(f.topHeight)) {
      findings.push(makeFinding({
        ruleId: 'INVALID_FLOOR_ELEVATION', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)} is missing baseHeight/topHeight.`,
        suggestedFix: 'Set baseHeight/topHeight from the verified floor/building elevation.',
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
      continue
    }

    if (!(f.baseHeight < f.topHeight)) {
      findings.push(makeFinding({
        ruleId: 'INVALID_FLOOR_ELEVATION', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)}: baseHeight (${f.baseHeight}) is not below topHeight (${f.topHeight}).`,
        suggestedFix: 'Set zMin lower than zMax using the verified floor/building elevation.',
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
      continue
    }

    if (f.baseHeight < -TOPOLOGY_CONFIG.verticalToleranceM) {
      findings.push(makeFinding({
        ruleId: 'INVALID_FLOOR_ELEVATION', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)}: baseHeight (${f.baseHeight} m) is negative.`,
        suggestedFix: 'A floor base below the building’s ground elevation is implausible — verify the elevation source.',
        computedValue: f.baseHeight, tolerance: 0,
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
    }

    const h = f.topHeight - f.baseHeight
    if (h < MIN_STOREY_M - 1e-6 || h > MAX_STOREY_M + 1e-6) {
      findings.push(makeFinding({
        ruleId: 'INVALID_FLOOR_ELEVATION', status: STATUS.WARNING, severity: SEVERITY.MEDIUM,
        entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)}'s storey height (${h.toFixed(2)} m) is outside the plausible ${MIN_STOREY_M}–${MAX_STOREY_M} m range.`,
        suggestedFix: 'Confirm the floor height against the building’s declared floorHeightM.',
        computedValue: Number(h.toFixed(2)), tolerance: MAX_STOREY_M,
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
    }

    // FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE (alias: PARENT_CONTAINMENT) — the
    // floor's own z-band must sit inside the building's declared z-envelope.
    if (finite(building.baseElevationM) && finite(building.heightM)) {
      const bMin = building.baseElevationM
      const bMax = building.baseElevationM + building.heightM
      const outLow = bMin - f.baseHeight
      const outHigh = f.topHeight - bMax
      const maxOut = Math.max(outLow, outHigh, 0)
      if (maxOut > TOPOLOGY_CONFIG.verticalToleranceM) {
        findings.push(makeFinding({
          ruleId: 'FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
          message: `Floor ${fid(f)} (${f.baseHeight}–${f.topHeight} m) extends ${maxOut.toFixed(2)} m beyond building ${building.buildingSegment || building.buildingId}'s declared height envelope (${bMin}–${bMax} m).`,
          suggestedFix: 'Reconcile the floor’s elevation with the building’s baseElevationM/heightM.',
          computedValue: Number(maxOut.toFixed(3)), tolerance: TOPOLOGY_CONFIG.verticalToleranceM,
          provenance: 'DEMO', focusRef: focusRef(f),
        }))
      }
    }
  }
  return findings
}

/** Rules: INCORRECT_STACKING (alias Z_CONTINUITY), FLOOR_OVERLAP — per building, floors ordered by floorNumber. */
export function validateFloorStacking(buildingId, floorsOfBuilding, locality) {
  const findings = []
  const sorted = [...floorsOfBuilding]
    .filter((f) => finite(f.baseHeight) && finite(f.topHeight))
    .sort((a, b) => a.floorNumber - b.floorNumber)

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const cur = sorted[i]

    if (cur.baseHeight + Z_TOLERANCE_M < prev.baseHeight) {
      findings.push(makeFinding({
        ruleId: 'INCORRECT_STACKING', entityType: 'FLOOR', entityId: fid(cur), relatedEntityId: fid(prev), parentEntityId: buildingId, locality,
        message: `Floor ${fid(cur)} (base ${cur.baseHeight} m) sits below floor ${fid(prev)} (base ${prev.baseHeight} m) despite a higher floor number.`,
        suggestedFix: 'Re-order or correct the floor elevations so floor number order matches vertical order.',
        computedValue: Number((prev.baseHeight - cur.baseHeight).toFixed(3)), tolerance: Z_TOLERANCE_M,
        provenance: 'DEMO', focusRef: focusRef(cur), relatedFocusRef: focusRef(prev),
      }))
      continue
    }

    const gap = cur.baseHeight - prev.topHeight
    if (gap < -Z_TOLERANCE_M) {
      findings.push(makeFinding({
        ruleId: 'FLOOR_OVERLAP', entityType: 'FLOOR', entityId: fid(cur), relatedEntityId: fid(prev), parentEntityId: buildingId, locality,
        message: `Floor ${fid(cur)} (${cur.baseHeight}–${cur.topHeight} m) overlaps floor ${fid(prev)} (${prev.baseHeight}–${prev.topHeight} m) by ${Math.abs(gap).toFixed(2)} m.`,
        suggestedFix: 'Adjust the two floors’ elevations so they no longer occupy the same vertical space.',
        computedValue: Number(Math.abs(gap).toFixed(3)), tolerance: Z_TOLERANCE_M,
        provenance: 'DEMO', focusRef: focusRef(cur), relatedFocusRef: focusRef(prev),
      }))
    } else if (gap > TOPOLOGY_CONFIG.stackingGapWarnM) {
      const status = gap > TOPOLOGY_CONFIG.stackingGapErrorM ? STATUS.ERROR : STATUS.WARNING
      findings.push(makeFinding({
        ruleId: 'INCORRECT_STACKING', status, severity: status === STATUS.ERROR ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        entityType: 'FLOOR', entityId: fid(cur), relatedEntityId: fid(prev), parentEntityId: buildingId, locality,
        message: `Unexplained ${gap.toFixed(2)} m vertical gap between floor ${fid(prev)} (top ${prev.topHeight} m) and floor ${fid(cur)} (base ${cur.baseHeight} m).`,
        suggestedFix: 'Confirm whether a floor is missing between these two, or correct the elevations.',
        computedValue: Number(gap.toFixed(3)), tolerance: TOPOLOGY_CONFIG.stackingGapWarnM,
        provenance: 'DEMO', focusRef: focusRef(cur), relatedFocusRef: focusRef(prev),
      }))
    }
  }
  return findings
}

/** Rule: DUPLICATE_FLOOR — same floorNumber twice in one building, or identical z-bands. */
export function validateDuplicateFloors(buildingId, floorsOfBuilding, locality) {
  const findings = []
  const byNumber = new Map()
  for (const f of floorsOfBuilding) {
    if (!byNumber.has(f.floorNumber)) byNumber.set(f.floorNumber, [])
    byNumber.get(f.floorNumber).push(f)
  }
  for (const [, group] of byNumber) {
    if (group.length < 2) continue
    for (let i = 1; i < group.length; i += 1) {
      findings.push(makeFinding({
        ruleId: 'DUPLICATE_FLOOR', entityType: 'FLOOR', entityId: fid(group[i]), relatedEntityId: fid(group[0]), parentEntityId: buildingId, locality,
        message: `Floor number ${group[0].floorNumber} is used by both ${fid(group[0])} and ${fid(group[i])} in building ${buildingId}.`,
        suggestedFix: 'Renumber or merge the duplicate floor records; retain the authoritative one.',
        provenance: 'DEMO', focusRef: focusRef(group[i]), relatedFocusRef: focusRef(group[0]),
      }))
    }
  }
  return findings
}

/** Rule: FLOOR_NOT_IN_BUILDING. Structurally guaranteed VALID today — a floor's horizontal extent IS its building's footprint (see file header) — implemented for completeness/future-proofing. */
export function validateFloorNotInBuilding(floors, buildingsById) {
  const findings = []
  for (const f of floors) {
    if (!f.geometry) continue // no independent geometry to check against the building — nothing to flag
    const building = buildingsById.get(f.buildingId)
    if (!building?.geometry) {
      findings.push(makeFinding({
        ruleId: 'FLOOR_NOT_IN_BUILDING', entityType: 'FLOOR', entityId: fid(f), parentEntityId: f.buildingId, locality: f.locality,
        message: `Floor ${fid(f)} declares its own geometry but its parent building has none to contain it.`,
        suggestedFix: 'Remove the floor-level geometry override or supply a valid parent building footprint.',
        provenance: 'DEMO', focusRef: focusRef(f),
      }))
    }
  }
  return findings
}
