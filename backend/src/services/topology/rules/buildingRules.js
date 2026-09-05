// Deterministic building footprint rules (Phase 7, RULE_ENGINE). Pure
// functions operating on already-fetched docs + already-computed geometry
// engine results — same convention as parcelRules.js. Parent-parcel
// containment reuses Phase 2's own AABB math (geometry3d/volume.js) rather
// than reimplementing a second containment algorithm.

import { volumeFromFootprint, toMetreBox, volumeRef, boxContains, boxOverlapM2 } from '../../geometry3d/volume.js'
import { outerRing } from '../../gnss/geomUtils.js'
import { makeFinding } from '../result.js'
import { STATUS, SEVERITY } from '../severity.js'
import { TOPOLOGY_CONFIG } from '../tolerances.js'

const bid = (b) => b.buildingSegment || b.buildingId
const focusRef = (b) => ({ kind: 'building', buildingId: b.buildingId, ulpin: b.ulpin })
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/** Rules: EMPTY_BUILDING_GEOMETRY, INVALID_BUILDING_FOOTPRINT, SELF_INTERSECTING_BUILDING, INVALID_BUILDING_AREA. */
export function validateBuildingGeometry(buildings, polygonAnalysis) {
  const findings = []
  for (const b of buildings) {
    const ring = outerRing(b.geometry)
    if (!ring) {
      findings.push(makeFinding({
        ruleId: 'EMPTY_BUILDING_GEOMETRY', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin, locality: b.locality,
        message: `Building ${bid(b)} has no usable footprint geometry.`,
        suggestedFix: 'Supply a valid GeoJSON Polygon footprint for this building.',
        provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b),
      }))
      continue
    }

    const geo = polygonAnalysis.get(`building:${b.buildingId}`)
    if (!geo || geo.available === false) {
      findings.push(makeFinding({
        ruleId: 'GEOMETRY_ENGINE_UNAVAILABLE', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin, locality: b.locality,
        message: `Building ${bid(b)}: footprint validity could not be checked — the geometry engine (ai-service) is unavailable.`,
        provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b),
      }))
      continue
    }

    if (geo.isSimple === false) {
      findings.push(makeFinding({
        ruleId: 'SELF_INTERSECTING_BUILDING', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin, locality: b.locality,
        message: `Building ${bid(b)}'s footprint self-intersects.`,
        suggestedFix: 'Repair the footprint ring and remove crossing segments.',
        geometry: b.geometry, provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b),
      }))
    } else if (geo.isValid === false) {
      findings.push(makeFinding({
        ruleId: 'INVALID_BUILDING_FOOTPRINT', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin, locality: b.locality,
        message: `Building ${bid(b)} footprint is invalid${geo.validityReason ? `: ${geo.validityReason}` : '.'}`,
        suggestedFix: 'Repair the footprint polygon and re-validate.',
        geometry: b.geometry, provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b),
      }))
    } else if (finite(geo.areaM2) && geo.areaM2 < TOPOLOGY_CONFIG.minAreaM2) {
      // Buildings carry no independently declared footprint area in this data
      // model, so INVALID_BUILDING_AREA is a plausibility floor on the
      // geometry-derived area itself, not a declared-vs-geometry mismatch
      // (contrast with parcels' INVALID_AREA, which has both fields).
      findings.push(makeFinding({
        ruleId: 'INVALID_BUILDING_AREA', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin, locality: b.locality,
        message: `Building ${bid(b)}'s footprint area (${geo.areaM2.toFixed(2)} m²) is below the plausible minimum.`,
        suggestedFix: 'Confirm the footprint was digitised at the correct scale/coordinates.',
        computedValue: Number(geo.areaM2.toFixed(2)), tolerance: TOPOLOGY_CONFIG.minAreaM2,
        provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b),
      }))
    }
  }
  return findings
}

/**
 * Rules: BUILDING_OUTSIDE_PARCEL (alias BUILDING_NOT_IN_PARCEL),
 * BUILDING_CROSSES_PARCEL_BOUNDARY. Horizontal-footprint containment via
 * Phase 2's own boxContains/toMetreBox — the identical computation
 * `geometry3d/validate.js` already uses for its own BUILDING_INSIDE_PARCEL
 * check, re-expressed under the Phase 7 finding schema.
 */
export function validateBuildingParcelContainment(buildings, parcelsById) {
  const findings = []
  for (const b of buildings) {
    const parcel = parcelsById.get(b.ulpin)
    const bRing = outerRing(b.geometry)
    if (!parcel || !bRing) continue
    const pRing = outerRing(parcel.geometry)
    if (!pRing) continue

    const bv = volumeFromFootprint(b.geometry, 0, 1)
    const pv = volumeFromFootprint(parcel.geometry, 0, 1)
    const ref = volumeRef(pv)
    const bBox = toMetreBox(bv, ref)
    const pBox = toMetreBox(pv, ref)
    if (!bBox || !pBox) continue

    const { inside, maxOutM } = boxContains(pBox, bBox, TOPOLOGY_CONFIG.horizontalToleranceM)
    if (inside) continue

    const overlap = boxOverlapM2(bBox, pBox)
    const buildingAreaM2 = Math.max(0, (bBox.xmax - bBox.xmin) * (bBox.ymax - bBox.ymin))
    const coverage = buildingAreaM2 > 0 ? overlap / buildingAreaM2 : 0

    if (coverage < 0.5) {
      findings.push(makeFinding({
        ruleId: 'BUILDING_OUTSIDE_PARCEL', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin,
        relatedEntityId: parcel.parcelId, locality: b.locality,
        message: `Building ${bid(b)} is ${coverage <= 0 ? 'completely' : 'significantly'} outside parcel ${parcel.parcelId || parcel.ulpin} (only ${(coverage * 100).toFixed(0)}% of its footprint falls inside).`,
        suggestedFix: 'Review the parent-parcel association or the building footprint digitisation.',
        computedValue: Number((1 - coverage).toFixed(3)), tolerance: TOPOLOGY_CONFIG.horizontalToleranceM,
        provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b), relatedFocusRef: { kind: 'parcel', ulpin: parcel.ulpin },
      }))
    } else {
      findings.push(makeFinding({
        ruleId: 'BUILDING_CROSSES_PARCEL_BOUNDARY', entityType: 'BUILDING', entityId: b.buildingId, parentEntityId: b.ulpin,
        relatedEntityId: parcel.parcelId, locality: b.locality,
        message: `Building ${bid(b)} extends ${maxOutM.toFixed(2)} m beyond parcel ${parcel.parcelId || parcel.ulpin}'s boundary (tolerance ${TOPOLOGY_CONFIG.horizontalToleranceM} m).`,
        suggestedFix: 'Review the building footprint against the parcel boundary; a small setback violation may need a boundary-review proposal (Phase 6).',
        computedValue: Number(maxOutM.toFixed(3)), tolerance: TOPOLOGY_CONFIG.horizontalToleranceM,
        provenance: b.constructionStatus || 'DEMO', focusRef: focusRef(b), relatedFocusRef: { kind: 'parcel', ulpin: parcel.ulpin },
      }))
    }
  }
  return findings
}

/** Rules: BUILDING_OVERLAP, DUPLICATE_BUILDING — one finding per candidate pair. */
export function validateBuildingOverlaps(pairs, metricsMap) {
  const findings = []
  for (const [a, b] of pairs) {
    const key = `${a.buildingId}::${b.buildingId}`
    const m = metricsMap.get(key)
    if (!m || m.available === false || !m.intersects) continue

    if (m.iou >= TOPOLOGY_CONFIG.duplicateIouThreshold) {
      findings.push(makeFinding({
        ruleId: 'DUPLICATE_BUILDING', entityType: 'BUILDING', entityId: a.buildingId, relatedEntityId: b.buildingId, parentEntityId: a.ulpin, locality: a.locality,
        message: `Building ${bid(a)} and ${bid(b)} have effectively identical footprints (IoU ${m.iou.toFixed(2)}).`,
        suggestedFix: 'Review the duplicate building records and retain the authoritative source.',
        computedValue: Number(m.iou.toFixed(3)), tolerance: TOPOLOGY_CONFIG.duplicateIouThreshold,
        provenance: a.constructionStatus || 'DEMO', focusRef: focusRef(a), relatedFocusRef: focusRef(b),
      }))
      continue
    }

    if (m.overlapAreaM2 > TOPOLOGY_CONFIG.overlapAreaTolM2) {
      findings.push(makeFinding({
        ruleId: 'BUILDING_OVERLAP', status: STATUS.ERROR, severity: SEVERITY.HIGH,
        entityType: 'BUILDING', entityId: a.buildingId, relatedEntityId: b.buildingId, parentEntityId: a.ulpin, locality: a.locality,
        message: `Building ${bid(a)} overlaps building ${bid(b)} by ${m.overlapAreaM2.toFixed(1)} m².`,
        suggestedFix: 'Review both building footprints — two structures should not occupy the same footprint area.',
        computedValue: Number(m.overlapAreaM2.toFixed(2)), tolerance: TOPOLOGY_CONFIG.overlapAreaTolM2,
        provenance: a.constructionStatus || 'DEMO', focusRef: focusRef(a), relatedFocusRef: focusRef(b),
      }))
    }
  }
  return findings
}
