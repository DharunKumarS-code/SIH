// Deterministic apartment/unit rules (Phase 7, RULE_ENGINE). Reuses Phase 2's
// own AABB math (geometry3d/volume.js: toMetreBox/volumeRef/boxContains/
// boxOverlapM2) for the footprint-level checks — the identical computation
// `geometry3d/validate.js` already performs for UNIT_INSIDE_BUILDING /
// UNIT_NO_OVERLAP, re-expressed under the Phase 7 finding schema.
//
// INVALID_UNIT_VOLUME / INVALID_Z_RANGE / UNIT_VERTICAL_OVERLAP /
// UNIT_DISCONNECTED are intrinsically 3D-volume concepts and are produced by
// volumeRules.js instead, which runs the same per-volume/pairwise checks
// uniformly across buildings, floors AND units — see docs/19 section 4 for
// the full rule-to-module cross-reference.

import { volumeFromFootprint, toMetreBox, volumeRef, boxContains, boxOverlapM2 } from '../../geometry3d/volume.js'
import { GEOMETRY_TOLERANCE_M, Z_TOLERANCE_M } from '../../geometry3d/volume.js'
import { outerRing } from '../../gnss/geomUtils.js'
import { makeFinding } from '../result.js'
import { TOPOLOGY_CONFIG } from '../tolerances.js'

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const uid = (u) => u.unitId || u.propertyId
const focusRef = (u) => ({ kind: 'unit', propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin })

/** Rule: UNIT_OVERLAP — units on the same floor of the same building must not overlap horizontally. */
export function validateUnitOverlaps(buildingId, unitsOfBuilding, locality) {
  const findings = []
  const byFloor = new Map()
  for (const u of unitsOfBuilding) {
    if (!byFloor.has(u.floorNumber)) byFloor.set(u.floorNumber, [])
    byFloor.get(u.floorNumber).push(u)
  }
  for (const [, group] of byFloor) {
    const ref = volumeRef(volumeFromFootprint(group[0]?.geometry, 0, 1)) || undefined
    const boxes = group
      .map((u) => ({ u, box: toMetreBox(volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight), ref) }))
      .filter((x) => x.box)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const ov = boxOverlapM2(boxes[i].box, boxes[j].box)
        if (ov > TOPOLOGY_CONFIG.overlapAreaTolM2) {
          findings.push(makeFinding({
            ruleId: 'UNIT_OVERLAP', entityType: 'UNIT', entityId: uid(boxes[i].u), relatedEntityId: uid(boxes[j].u), parentEntityId: buildingId, locality,
            message: `Apartment ${uid(boxes[i].u)} overlaps ${uid(boxes[j].u)} by ${ov.toFixed(1)} m².`,
            suggestedFix: 'Adjust the unit boundary or review the floor-plan segmentation that produced it.',
            computedValue: Number(ov.toFixed(2)), tolerance: TOPOLOGY_CONFIG.overlapAreaTolM2,
            provenance: boxes[i].u.status || 'DEMO', focusRef: focusRef(boxes[i].u), relatedFocusRef: focusRef(boxes[j].u),
          }))
        }
      }
    }
  }
  return findings
}

/** Rules: UNIT_OUTSIDE_BUILDING (alias UNIT_NOT_IN_BUILDING), UNIT_OUTSIDE_FLOOR (alias UNIT_NOT_IN_FLOOR, PARENT_CONTAINMENT). */
export function validateUnitContainment(units, buildingsById, floorsById) {
  const findings = []
  for (const u of units) {
    const building = buildingsById.get(u.buildingId)
    if (!building?.geometry || !u.geometry) continue

    const bv = volumeFromFootprint(building.geometry, 0, 1)
    const uv = volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight)
    const ref = volumeRef(bv)
    const bBox = toMetreBox(bv, ref)
    const uBox = toMetreBox(uv, ref)
    if (bBox && uBox) {
      const { inside, maxOutM } = boxContains(bBox, uBox, GEOMETRY_TOLERANCE_M)
      if (!inside) {
        findings.push(makeFinding({
          ruleId: 'UNIT_OUTSIDE_BUILDING', entityType: 'UNIT', entityId: uid(u), parentEntityId: u.buildingId, locality: u.locality,
          message: `Apartment ${uid(u)} extends ${maxOutM.toFixed(2)} m outside building ${building.buildingSegment || building.buildingId}'s footprint (tolerance ${GEOMETRY_TOLERANCE_M} m).`,
          suggestedFix: 'Adjust the unit boundary or review the floor-plan segmentation that produced it.',
          computedValue: Number(maxOutM.toFixed(3)), tolerance: GEOMETRY_TOLERANCE_M,
          provenance: u.status || 'DEMO', focusRef: focusRef(u),
        }))
      }
    }

    const floorId = u.floorId || `${u.buildingId}-F${String(u.floorNumber).padStart(2, '0')}`
    const floor = floorsById.get(floorId)
    if (floor && finite(floor.baseHeight) && finite(floor.topHeight) && finite(u.baseHeight) && finite(u.topHeight)) {
      const outLow = floor.baseHeight - u.baseHeight
      const outHigh = u.topHeight - floor.topHeight
      const maxOut = Math.max(outLow, outHigh, 0)
      if (maxOut > Z_TOLERANCE_M) {
        findings.push(makeFinding({
          ruleId: 'UNIT_OUTSIDE_FLOOR', entityType: 'UNIT', entityId: uid(u), parentEntityId: floorId, locality: u.locality,
          message: `Apartment ${uid(u)} (${u.baseHeight}–${u.topHeight} m) extends ${maxOut.toFixed(2)} m beyond floor ${floor.floorSegment || floorId}'s vertical band (${floor.baseHeight}–${floor.topHeight} m).`,
          suggestedFix: 'Align the unit’s baseHeight/topHeight with its parent floor’s verified elevation band.',
          computedValue: Number(maxOut.toFixed(3)), tolerance: Z_TOLERANCE_M,
          provenance: u.status || 'DEMO', focusRef: focusRef(u),
        }))
      }
    }
  }
  return findings
}

/** Rule: DUPLICATE_UNIT — same building+floor with effectively identical footprints. */
export function validateDuplicateUnits(buildingId, unitsOfBuilding, locality) {
  const findings = []
  const byFloor = new Map()
  for (const u of unitsOfBuilding) {
    if (!byFloor.has(u.floorNumber)) byFloor.set(u.floorNumber, [])
    byFloor.get(u.floorNumber).push(u)
  }
  for (const [, group] of byFloor) {
    const ref = volumeRef(volumeFromFootprint(group[0]?.geometry, 0, 1)) || undefined
    const boxed = group
      .map((u) => ({ u, box: toMetreBox(volumeFromFootprint(u.geometry, 0, 1), ref) }))
      .filter((x) => x.box)
    for (let i = 0; i < boxed.length; i += 1) {
      for (let j = i + 1; j < boxed.length; j += 1) {
        const a = boxed[i].box
        const b = boxed[j].box
        const areaA = Math.max(0, (a.xmax - a.xmin) * (a.ymax - a.ymin))
        const overlap = boxOverlapM2(a, b)
        const nearIdentical = areaA > 0
          && Math.abs(a.xmin - b.xmin) < GEOMETRY_TOLERANCE_M && Math.abs(a.xmax - b.xmax) < GEOMETRY_TOLERANCE_M
          && Math.abs(a.ymin - b.ymin) < GEOMETRY_TOLERANCE_M && Math.abs(a.ymax - b.ymax) < GEOMETRY_TOLERANCE_M
          && overlap / areaA > TOPOLOGY_CONFIG.duplicateIouThreshold
        if (nearIdentical) {
          findings.push(makeFinding({
            ruleId: 'DUPLICATE_UNIT', entityType: 'UNIT', entityId: uid(boxed[i].u), relatedEntityId: uid(boxed[j].u), parentEntityId: buildingId, locality,
            message: `Apartment ${uid(boxed[i].u)} and ${uid(boxed[j].u)} have effectively identical geometry on the same floor.`,
            suggestedFix: 'Review the duplicate unit records and retain the authoritative source.',
            computedValue: Number((overlap / areaA).toFixed(3)), tolerance: TOPOLOGY_CONFIG.duplicateIouThreshold,
            provenance: boxed[i].u.status || 'DEMO', focusRef: focusRef(boxed[i].u), relatedFocusRef: focusRef(boxed[j].u),
          }))
        }
      }
    }
  }
  return findings
}

/** Rule: INVALID_UNIT_AREA — declared carpet/built-up area vs geometry-derived footprint area. */
export function validateUnitArea(units) {
  const findings = []
  const SQFT_TO_M2 = 0.092903
  for (const u of units) {
    const ring = outerRing(u.geometry)
    if (!ring) continue
    const declaredSqft = u.builtUpAreaSqft ?? u.carpetAreaSqft
    if (!finite(declaredSqft) || declaredSqft <= 0) continue
    const box = toMetreBox(volumeFromFootprint(u.geometry, 0, 1))
    if (!box) continue
    const geomAreaM2 = Math.max(0, (box.xmax - box.xmin) * (box.ymax - box.ymin))
    if (geomAreaM2 <= 0) continue
    const declaredM2 = declaredSqft * SQFT_TO_M2
    const diff = Math.abs(declaredM2 - geomAreaM2) / geomAreaM2
    if (diff > TOPOLOGY_CONFIG.unitAreaMismatchFactor) {
      findings.push(makeFinding({
        ruleId: 'INVALID_UNIT_AREA', entityType: 'UNIT', entityId: uid(u), parentEntityId: u.buildingId, locality: u.locality,
        message: `Apartment ${uid(u)}'s declared area (${declaredM2.toFixed(1)} m²) differs from its footprint-derived area (${geomAreaM2.toFixed(1)} m²) by ${(diff * 100).toFixed(0)}%.`,
        suggestedFix: 'Reconcile the declared carpet/built-up area with the unit footprint, or correct whichever is wrong.',
        computedValue: Number(diff.toFixed(3)), tolerance: TOPOLOGY_CONFIG.unitAreaMismatchFactor,
        provenance: u.status || 'DEMO', focusRef: focusRef(u),
      }))
    }
  }
  return findings
}
