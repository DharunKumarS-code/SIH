// Deterministic parcel geometry rules (Phase 7, RULE_ENGINE). Pure functions:
// given already-fetched parcel docs plus already-computed geometry-engine
// results (intrinsic polygon analysis / pairwise metrics from
// geometryClient.js), return findings. No DB access, no HTTP here — that
// orchestration lives in engine.js, which is what makes these rules
// independently unit-testable.

import { outerRing } from '../../gnss/geomUtils.js'
import { makeFinding } from '../result.js'
import { STATUS, SEVERITY } from '../severity.js'
import { TOPOLOGY_CONFIG } from '../tolerances.js'

const pid = (p) => p.parcelId || p.ulpin
const focusRef = (p) => ({ kind: 'parcel', ulpin: p.ulpin })
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/** Rules: EMPTY_GEOMETRY, INVALID_POLYGON, SELF_INTERSECTION, INVALID_AREA. */
export function validateParcelGeometry(parcels, polygonAnalysis) {
  const findings = []
  for (const p of parcels) {
    const ring = outerRing(p.geometry)
    if (!ring) {
      findings.push(makeFinding({
        ruleId: 'EMPTY_GEOMETRY', entityType: 'PARCEL', entityId: pid(p), locality: p.locality,
        message: `Parcel ${pid(p)} has no usable geometry.`,
        suggestedFix: 'Supply a valid GeoJSON Polygon for this parcel before further validation.',
        provenance: p.status || 'DEMO', focusRef: focusRef(p),
      }))
      continue
    }

    const geo = polygonAnalysis.get(`parcel:${pid(p)}`)
    if (!geo || geo.available === false) {
      findings.push(makeFinding({
        ruleId: 'GEOMETRY_ENGINE_UNAVAILABLE', entityType: 'PARCEL', entityId: pid(p), locality: p.locality,
        message: `Parcel ${pid(p)}: polygon validity could not be checked — the geometry engine (ai-service) is unavailable.`,
        provenance: p.status || 'DEMO', focusRef: focusRef(p),
      }))
    } else {
      if (geo.isSimple === false) {
        findings.push(makeFinding({
          ruleId: 'SELF_INTERSECTION', entityType: 'PARCEL', entityId: pid(p), locality: p.locality,
          message: `Parcel ${pid(p)}'s boundary ring self-intersects.`,
          suggestedFix: 'Repair the polygon ring and remove crossing segments.',
          geometry: p.geometry, provenance: p.status || 'DEMO', focusRef: focusRef(p),
        }))
      } else if (geo.isValid === false) {
        findings.push(makeFinding({
          ruleId: 'INVALID_POLYGON', entityType: 'PARCEL', entityId: pid(p), locality: p.locality,
          message: `Parcel ${pid(p)} geometry is invalid${geo.validityReason ? `: ${geo.validityReason}` : '.'}`,
          suggestedFix: 'Repair the polygon (close the ring, remove self-touching vertices) and re-validate.',
          geometry: p.geometry, provenance: p.status || 'DEMO', focusRef: focusRef(p),
        }))
      }

      if (geo.isValid !== false && finite(p.areaSqm) && finite(geo.areaM2) && geo.areaM2 > 0) {
        const diff = Math.abs(p.areaSqm - geo.areaM2) / geo.areaM2
        if (diff > TOPOLOGY_CONFIG.areaMismatchFactor) {
          findings.push(makeFinding({
            ruleId: 'INVALID_AREA', entityType: 'PARCEL', entityId: pid(p), locality: p.locality,
            message: `Parcel ${pid(p)}'s declared area (${p.areaSqm.toFixed(0)} m²) differs from its geometry-derived area (${geo.areaM2.toFixed(0)} m²) by ${(diff * 100).toFixed(0)}%.`,
            suggestedFix: 'Reconcile the declared area field with the parcel geometry, or correct whichever is wrong.',
            computedValue: Number(diff.toFixed(3)), tolerance: TOPOLOGY_CONFIG.areaMismatchFactor,
            provenance: p.status || 'DEMO', focusRef: focusRef(p),
          }))
        }
      }
    }
  }
  return findings
}

/** Rules: OVERLAPPING_PARCELS, DUPLICATE_PARCEL_GEOMETRY — one finding per candidate pair. */
export function validateParcelOverlaps(pairs, metricsMap) {
  const findings = []
  for (const [a, b] of pairs) {
    const key = `${pid(a)}::${pid(b)}`
    const m = metricsMap.get(key)
    if (!m || m.available === false || !m.intersects) continue

    if (m.iou >= TOPOLOGY_CONFIG.duplicateIouThreshold) {
      findings.push(makeFinding({
        ruleId: 'DUPLICATE_PARCEL_GEOMETRY', entityType: 'PARCEL', entityId: pid(a), relatedEntityId: pid(b), locality: a.locality,
        message: `Parcel ${pid(a)} and ${pid(b)} have effectively identical geometry (IoU ${m.iou.toFixed(2)}).`,
        suggestedFix: 'Review the duplicate parcel records and retain the authoritative source.',
        computedValue: Number(m.iou.toFixed(3)), tolerance: TOPOLOGY_CONFIG.duplicateIouThreshold,
        provenance: a.status || 'DEMO', focusRef: focusRef(a), relatedFocusRef: focusRef(b),
      }))
      continue
    }

    if (m.overlapAreaM2 > TOPOLOGY_CONFIG.overlapAreaTolM2) {
      findings.push(makeFinding({
        ruleId: 'OVERLAPPING_PARCELS', entityType: 'PARCEL', entityId: pid(a), relatedEntityId: pid(b), locality: a.locality,
        message: `Parcel ${pid(a)} overlaps parcel ${pid(b)} by ${m.overlapAreaM2.toFixed(1)} m².`,
        suggestedFix: 'Review the two parcel boundaries with the survey/records team; overlapping cadastral parcels cannot both be authoritative as drawn.',
        computedValue: Number(m.overlapAreaM2.toFixed(2)), tolerance: TOPOLOGY_CONFIG.overlapAreaTolM2,
        provenance: a.status || 'DEMO', focusRef: focusRef(a), relatedFocusRef: focusRef(b),
      }))
    }
  }
  return findings
}

/**
 * Rule: GAPS. Classifies a non-overlapping parcel pair's boundary-to-boundary
 * distance as ERROR (suspiciously tiny — reads as a topology defect),
 * WARNING (small, unexplained), or no finding at all (large enough to be a
 * plausible road/setback, or already touching). The spec is explicit that
 * not every gap is an error — this is a deliberately configurable heuristic,
 * not an authoritative topology fact.
 */
export function validateParcelGaps(pairs, gapDistanceOf) {
  const findings = []
  for (const [a, b] of pairs) {
    const d = gapDistanceOf(a, b)
    if (d == null || d <= TOPOLOGY_CONFIG.horizontalToleranceM) continue // touching within tolerance — not a gap
    if (d > TOPOLOGY_CONFIG.gapCandidateRadiusM) continue // far enough apart to be unrelated / an intentional setback

    const status = d <= TOPOLOGY_CONFIG.gapErrorMaxM ? STATUS.ERROR : d <= TOPOLOGY_CONFIG.gapWarnMaxM ? STATUS.WARNING : STATUS.VALID
    if (status === STATUS.VALID) continue // classified INFO-equivalent: plausible gap, not reported as a finding
    findings.push(makeFinding({
      ruleId: 'GAPS', status, severity: status === STATUS.ERROR ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      entityType: 'PARCEL', entityId: pid(a), relatedEntityId: pid(b), locality: a.locality,
      message: `Parcel ${pid(a)} and ${pid(b)} are ${d.toFixed(2)} m apart — closer than expected for two supposedly adjacent parcels.`,
      suggestedFix: 'Confirm whether a shared boundary was intended; if so, align the two parcel boundaries.',
      computedValue: Number(d.toFixed(3)), tolerance: TOPOLOGY_CONFIG.gapErrorMaxM,
      provenance: a.status || 'DEMO', focusRef: focusRef(a), relatedFocusRef: focusRef(b),
    }))
  }
  return findings
}
