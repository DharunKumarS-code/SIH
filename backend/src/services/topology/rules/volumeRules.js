// Deterministic 3D volume rules (Phase 7, RULE_ENGINE). Runs the same
// intrinsic-box and pairwise checks uniformly across every assembled Phase 2
// volume (building/floor/unit) — reusing volumeFromFootprint/toMetreBox/
// boxOverlapM2/volumeMetrics/deriveVolumeId directly rather than a second,
// competing 3D math implementation.
//
// entityType is always 'VOLUME' here — the domain-specific rule modules
// (buildingRules/floorRules/unitRules) report the same underlying entity
// under its own entityType (BUILDING/FLOOR/UNIT) for their own checks, so a
// UI filtering by entity still finds the right rows either way.

import {
  volumeFromFootprint, deriveVolumeId, toMetreBox, volumeRef, boxOverlapM2, volumeMetrics,
} from '../../geometry3d/volume.js'
import { candidatePairs } from '../spatialIndex.js'
import { outerRing } from '../../gnss/geomUtils.js'
import { makeFinding } from '../result.js'
import { STATUS, SEVERITY } from '../severity.js'
import { TOPOLOGY_CONFIG } from '../tolerances.js'

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * Assemble one volume descriptor per building/floor/unit — the shared input
 * every function below operates on.
 * @returns {Array<{entityType, entityId, parentEntityId, locality, provenance, focusRef, ring, geometry, v:{xmin..zmax}}>}
 */
export function assembleVolumes({ buildings, floors, units }) {
  const buildingsById = new Map(buildings.map((b) => [b.buildingId, b]))
  const out = []

  for (const b of buildings) {
    if (!b.geometry) continue
    const v = volumeFromFootprint(b.geometry, b.baseElevationM ?? 0, (b.baseElevationM ?? 0) + (b.heightM ?? 0), { volumeId: deriveVolumeId('building', b) })
    if (v) out.push({ entityType: 'BUILDING', entityId: v.volumeId, parentEntityId: b.ulpin, locality: b.locality, provenance: b.constructionStatus || 'DEMO', focusRef: { kind: 'building', buildingId: b.buildingId, ulpin: b.ulpin }, geometry: b.geometry, v })
  }
  for (const f of floors) {
    const building = buildingsById.get(f.buildingId)
    if (!building?.geometry) continue
    const v = volumeFromFootprint(building.geometry, f.baseHeight, f.topHeight, { volumeId: deriveVolumeId('floor', f) })
    if (v) out.push({ entityType: 'FLOOR', entityId: v.volumeId, parentEntityId: f.buildingId, locality: f.locality, provenance: 'DEMO', focusRef: { kind: 'floor', buildingId: f.buildingId, floorNumber: f.floorNumber, ulpin: f.ulpin }, geometry: building.geometry, v })
  }
  for (const u of units) {
    if (!u.geometry) continue
    const v = volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight, { volumeId: deriveVolumeId('unit', u) })
    if (v) out.push({ entityType: 'UNIT', entityId: v.volumeId, parentEntityId: u.buildingId, locality: u.locality, provenance: u.status || 'DEMO', focusRef: { kind: 'unit', propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin }, geometry: u.geometry, ref: u, v })
  }
  return out
}

/** Rules: INVALID_X_RANGE, INVALID_Y_RANGE, INVALID_Z_RANGE, INVALID_HEIGHT, ZERO_OR_NEGATIVE_VOLUME. */
export function validateVolumeIntrinsics(volumes) {
  const findings = []
  for (const vol of volumes) {
    const { v } = vol
    if (!v || !finite(v.xmin) || !finite(v.xmax) || !finite(v.ymin) || !finite(v.ymax) || !finite(v.zmin) || !finite(v.zmax)) {
      findings.push(makeFinding({
        ruleId: 'INVALID_Z_RANGE', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
        message: `Volume ${vol.entityId}: one or more bounds are missing or non-numeric.`,
        suggestedFix: 'Ensure the underlying entity has complete geometry and elevation fields.',
        provenance: vol.provenance, focusRef: vol.focusRef,
      }))
      continue
    }

    let zOk = true
    if (!(v.xmin < v.xmax)) {
      findings.push(makeFinding({
        ruleId: 'INVALID_X_RANGE', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
        message: `Volume ${vol.entityId}: xmin (${v.xmin}) is not below xmax (${v.xmax}).`,
        suggestedFix: 'Repair the footprint so its horizontal bounds are ordered correctly.',
        provenance: vol.provenance, focusRef: vol.focusRef,
      }))
    }
    if (!(v.ymin < v.ymax)) {
      findings.push(makeFinding({
        ruleId: 'INVALID_Y_RANGE', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
        message: `Volume ${vol.entityId}: ymin (${v.ymin}) is not below ymax (${v.ymax}).`,
        suggestedFix: 'Repair the footprint so its horizontal bounds are ordered correctly.',
        provenance: vol.provenance, focusRef: vol.focusRef,
      }))
    }
    if (!(v.zmin < v.zmax)) {
      zOk = false
      findings.push(makeFinding({
        ruleId: 'INVALID_Z_RANGE', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
        message: `Volume ${vol.entityId}: zmin (${v.zmin}) is not below zmax (${v.zmax}).`,
        suggestedFix: 'Set zMin lower than zMax using the verified floor/building elevation.',
        provenance: vol.provenance, focusRef: vol.focusRef,
      }))
    }

    const metrics = volumeMetrics(v)
    if (zOk && metrics?.heightM != null) {
      if (metrics.heightM > TOPOLOGY_CONFIG.maxHeightM || metrics.heightM < TOPOLOGY_CONFIG.minHeightM) {
        findings.push(makeFinding({
          ruleId: 'INVALID_HEIGHT', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
          message: `Volume ${vol.entityId}'s height (${metrics.heightM} m) is outside the plausible ${TOPOLOGY_CONFIG.minHeightM}–${TOPOLOGY_CONFIG.maxHeightM} m range.`,
          suggestedFix: 'Verify the elevation source for this entity.',
          computedValue: metrics.heightM, tolerance: TOPOLOGY_CONFIG.maxHeightM,
          provenance: vol.provenance, focusRef: vol.focusRef,
        }))
      }
      if (metrics.volumeM3 != null && metrics.volumeM3 <= TOPOLOGY_CONFIG.minVolumeM3) {
        findings.push(makeFinding({
          ruleId: 'ZERO_OR_NEGATIVE_VOLUME', entityType: 'VOLUME', entityId: vol.entityId, parentEntityId: vol.parentEntityId, locality: vol.locality,
          message: `Volume ${vol.entityId} computes to ${metrics.volumeM3} m³ — at or below the plausible minimum.`,
          suggestedFix: 'Check the footprint for a degenerate (near-zero-area) shape.',
          computedValue: metrics.volumeM3, tolerance: TOPOLOGY_CONFIG.minVolumeM3,
          provenance: vol.provenance, focusRef: vol.focusRef,
        }))
      }
    }
  }
  return findings
}

// A UNIT/FLOOR is *expected* to sit inside its own parent BUILDING's volume,
// and a UNIT is *expected* to sit inside its own parent FLOOR's volume —
// those are containment relationships (checked elsewhere: buildingRules /
// floorRules / unitRules), never an "unexpected intersection". Comparing by
// `parentEntityId` alone isn't enough to catch this: a FLOOR's parentEntityId
// is its buildingId, but a BUILDING's parentEntityId is its ulpin — so a
// floor and its own building would otherwise look unrelated and both get
// fully box-intersected against each other.
function isExpectedContainmentPair(a, b) {
  const buildingIdOf = (v) => v.focusRef?.buildingId
  const floorKeyOf = (v) => (v.entityType === 'UNIT' || v.entityType === 'FLOOR') ? `${buildingIdOf(v)}#${v.focusRef?.floorNumber}` : null
  const isBuildingChild = (x, bld) => (x.entityType === 'UNIT' || x.entityType === 'FLOOR') && buildingIdOf(x) === buildingIdOf(bld)
  if (a.entityType === 'BUILDING' && isBuildingChild(b, a)) return true
  if (b.entityType === 'BUILDING' && isBuildingChild(a, b)) return true
  if (a.entityType === 'FLOOR' && b.entityType === 'UNIT' && floorKeyOf(a) === floorKeyOf(b)) return true
  if (b.entityType === 'FLOOR' && a.entityType === 'UNIT' && floorKeyOf(a) === floorKeyOf(b)) return true
  return false
}

/**
 * Rules: UNIT_VERTICAL_OVERLAP (alias VOLUME_INTERSECTION) for a unit/unit
 * pair, VOLUME_INTERSECTION otherwise — two volumes whose footprints overlap
 * AND whose z-ranges overlap, where they are not expected to (different
 * floors/buildings). Candidate pairs are bbox-prefiltered first.
 */
export function validateVolumeIntersections(volumes) {
  const findings = []
  const pairs = candidatePairs(volumes, (vol) => outerRing(vol.geometry), 0)
  for (const [a, b] of pairs) {
    if (a.entityType === 'UNIT' && b.entityType === 'UNIT' && a.ref?.floorId === b.ref?.floorId) continue // same-floor overlap is UNIT_OVERLAP's job
    if (isExpectedContainmentPair(a, b)) continue // a child legitimately sitting inside its own ancestor's volume

    const ref = volumeRef(a.v)
    const boxA = toMetreBox(a.v, ref)
    const boxB = toMetreBox(b.v, ref)
    if (!boxA || !boxB) continue
    const zOverlap = Math.min(boxA.zmax, boxB.zmax) - Math.max(boxA.zmin, boxB.zmin)
    if (zOverlap <= TOPOLOGY_CONFIG.verticalToleranceM) continue
    const xyOverlap = boxOverlapM2(boxA, boxB)
    if (xyOverlap <= TOPOLOGY_CONFIG.overlapAreaTolM2) continue

    const bothUnits = a.entityType === 'UNIT' && b.entityType === 'UNIT'
    findings.push(makeFinding({
      ruleId: bothUnits ? 'UNIT_VERTICAL_OVERLAP' : 'VOLUME_INTERSECTION',
      entityType: bothUnits ? 'UNIT' : 'VOLUME', entityId: a.entityId, relatedEntityId: b.entityId, parentEntityId: a.parentEntityId, locality: a.locality,
      message: `Volume ${a.entityId} unexpectedly intersects ${b.entityId} (${xyOverlap.toFixed(1)} m² horizontal overlap, ${zOverlap.toFixed(2)} m vertical overlap).`,
      suggestedFix: 'Review both entities’ elevation/footprint — they should not occupy the same 3D space.',
      computedValue: Number(xyOverlap.toFixed(2)), tolerance: TOPOLOGY_CONFIG.overlapAreaTolM2,
      provenance: a.provenance, focusRef: a.focusRef, relatedFocusRef: b.focusRef,
    }))
  }
  return findings
}

/** Rule: DUPLICATE_VOLUME — two volumes of the same entity type with near-identical XYZ bounds. */
export function validateDuplicateVolumes(volumes) {
  const findings = []
  const byType = new Map()
  for (const v of volumes) {
    if (!byType.has(v.entityType)) byType.set(v.entityType, [])
    byType.get(v.entityType).push(v)
  }
  for (const [, group] of byType) {
    const pairs = candidatePairs(group, (vol) => outerRing(vol.geometry), 0)
    for (const [a, b] of pairs) {
      const ref = volumeRef(a.v)
      const boxA = toMetreBox(a.v, ref)
      const boxB = toMetreBox(b.v, ref)
      if (!boxA || !boxB) continue
      const areaA = Math.max(0, (boxA.xmax - boxA.xmin) * (boxA.ymax - boxA.ymin))
      if (areaA <= 0) continue
      const xyIou = boxOverlapM2(boxA, boxB) / areaA
      const zClose = Math.abs(boxA.zmin - boxB.zmin) < TOPOLOGY_CONFIG.verticalToleranceM && Math.abs(boxA.zmax - boxB.zmax) < TOPOLOGY_CONFIG.verticalToleranceM
      if (xyIou > TOPOLOGY_CONFIG.duplicateIouThreshold && zClose) {
        findings.push(makeFinding({
          ruleId: 'DUPLICATE_VOLUME', entityType: 'VOLUME', entityId: a.entityId, relatedEntityId: b.entityId, parentEntityId: a.parentEntityId, locality: a.locality,
          message: `Volume ${a.entityId} and ${b.entityId} have near-identical 3D bounds.`,
          suggestedFix: 'Review the duplicate volume records and retain the authoritative source.',
          computedValue: Number(xyIou.toFixed(3)), tolerance: TOPOLOGY_CONFIG.duplicateIouThreshold,
          provenance: a.provenance, focusRef: a.focusRef, relatedFocusRef: b.focusRef,
        }))
      }
    }
  }
  return findings
}

/**
 * Rule: UNIT_DISCONNECTED (alias DISCONNECTED_GEOMETRY) — a unit whose
 * footprint has NO overlap at all with its own building's footprint and is
 * more than `disconnectionRadiusM` away from it. Distinct from
 * UNIT_OUTSIDE_BUILDING (unitRules.js), which fires for any out-of-tolerance
 * case, including a unit that still touches/overlaps its building.
 */
export function validateDisconnectedUnits(units, buildingsById) {
  const findings = []
  for (const u of units) {
    const building = buildingsById.get(u.buildingId)
    if (!building?.geometry || !u.geometry) continue
    const bv = volumeFromFootprint(building.geometry, 0, 1)
    const uv = volumeFromFootprint(u.geometry, 0, 1)
    const ref = volumeRef(bv)
    const bBox = toMetreBox(bv, ref)
    const uBox = toMetreBox(uv, ref)
    if (!bBox || !uBox) continue
    if (boxOverlapM2(bBox, uBox) > 0) continue // touches/overlaps — UNIT_OUTSIDE_BUILDING's territory, not disconnection
    const dx = Math.max(bBox.xmin - uBox.xmax, uBox.xmin - bBox.xmax, 0)
    const dy = Math.max(bBox.ymin - uBox.ymax, uBox.ymin - bBox.ymax, 0)
    const dist = Math.hypot(dx, dy)
    if (dist > TOPOLOGY_CONFIG.disconnectionRadiusM) {
      findings.push(makeFinding({
        ruleId: 'UNIT_DISCONNECTED', entityType: 'UNIT', entityId: u.unitId || u.propertyId, parentEntityId: u.buildingId, locality: u.locality,
        status: STATUS.WARNING, severity: SEVERITY.MEDIUM,
        message: `Apartment ${u.unitId || u.propertyId} is ${dist.toFixed(1)} m away from building ${building.buildingSegment || building.buildingId}'s footprint — not merely outside tolerance but disconnected.`,
        suggestedFix: 'Confirm the unit’s parent building association and footprint digitisation.',
        computedValue: Number(dist.toFixed(2)), tolerance: TOPOLOGY_CONFIG.disconnectionRadiusM,
        provenance: u.status || 'DEMO', focusRef: { kind: 'unit', propertyId: u.propertyId, buildingId: u.buildingId, floorNumber: u.floorNumber, ulpin: u.ulpin },
      }))
    }
  }
  return findings
}
