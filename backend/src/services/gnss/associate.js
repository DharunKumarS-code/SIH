// Spatial association of a GNSS/CORS control point with the existing demo
// parcels of a locality (spec section 10). A control point NEVER creates or
// changes a ULPIN — this only records which existing parcel (if any) it falls
// inside, and how confidently.
//
//   MATCHED          inside exactly one parcel, clear of its boundary by more
//                     than the configured tolerance
//   MULTI_PARCEL      inside two or more (overlapping) parcels
//   REVIEW_REQUIRED   inside a parcel but close to its boundary, OR outside
//                     every parcel but close to one — never arbitrarily
//                     resolved
//   OUTSIDE_PARCEL    not inside any parcel and not near one

import { GNSS_CONFIG } from './config.js'
import { distanceToRingM, outerRing, pointInRing } from './geomUtils.js'

/**
 * @param {{latitude:number, longitude:number}} point
 * @param {object[]} parcels  parcel docs for the locality (.geometry, .ulpin, .parcelId)
 * @param {object} [config]
 */
export function associateParcel(point, parcels, config = GNSS_CONFIG) {
  const pt = [point.longitude, point.latitude]
  const candidateRadiusM = config.boundaryToleranceM * config.candidateRadiusFactor

  const hits = []
  for (const p of parcels) {
    const ring = outerRing(p.geometry)
    if (!ring || ring.length < 4) continue
    const inside = pointInRing(pt, ring)
    const { distanceM: dist } = distanceToRingM(pt, ring)
    if (inside || dist <= candidateRadiusM) {
      hits.push({ parcelId: p.parcelId, ulpin: p.ulpin, inside, distanceM: Number(dist.toFixed(3)) })
    }
  }
  hits.sort((a, b) => a.distanceM - b.distanceM)
  const parcelCandidates = hits.map((h) => ({ parcelId: h.parcelId, ulpin: h.ulpin, distanceM: h.distanceM, inside: h.inside }))

  const insideHits = hits.filter((h) => h.inside)

  if (insideHits.length >= 2) {
    return { parcelStatus: 'MULTI_PARCEL', parentParcelId: null, parentULPIN: null, associationConfidence: 0, parcelCandidates, nearestBoundaryM: hits[0]?.distanceM ?? null }
  }

  if (insideHits.length === 1) {
    const h = insideHits[0]
    if (h.distanceM > config.boundaryToleranceM) {
      // Confidence saturates to 1.0 once the point is comfortably clear of the
      // boundary (at the candidate radius) — a documented, simple heuristic,
      // never a calibrated probability.
      return {
        parcelStatus: 'MATCHED',
        parentParcelId: h.parcelId,
        parentULPIN: h.ulpin || null,
        associationConfidence: Number(Math.min(1, h.distanceM / (candidateRadiusM || 1)).toFixed(3)),
        parcelCandidates,
        nearestBoundaryM: h.distanceM,
      }
    }
    return {
      parcelStatus: 'REVIEW_REQUIRED',
      parentParcelId: h.parcelId,
      parentULPIN: h.ulpin || null,
      associationConfidence: 0.3,
      parcelCandidates,
      nearestBoundaryM: h.distanceM,
      reviewReason: `Inside parcel ${h.parcelId} but only ${h.distanceM.toFixed(2)} m from its boundary (tolerance ${config.boundaryToleranceM} m).`,
    }
  }

  const nearest = hits[0]
  if (nearest && nearest.distanceM <= config.boundaryToleranceM) {
    return {
      parcelStatus: 'REVIEW_REQUIRED',
      parentParcelId: nearest.parcelId,
      parentULPIN: null,
      associationConfidence: 0.2,
      parcelCandidates,
      nearestBoundaryM: nearest.distanceM,
      reviewReason: `Just outside parcel ${nearest.parcelId}, ${nearest.distanceM.toFixed(2)} m from its boundary (tolerance ${config.boundaryToleranceM} m).`,
    }
  }

  return {
    parcelStatus: 'OUTSIDE_PARCEL',
    parentParcelId: null,
    parentULPIN: null,
    associationConfidence: 0,
    parcelCandidates,
    nearestBoundaryM: nearest?.distanceM ?? null,
  }
}
