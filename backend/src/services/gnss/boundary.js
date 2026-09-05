// Control-point-to-boundary verification & deviation analysis (spec sections
// 11-12). Compares EXISTING parcel boundary geometry against GNSS/CORS
// observed control points — it never modifies the parcel boundary itself.
// Residuals here are OBSERVED DEVIATIONS, never "official cadastral
// corrections" and never conflated with a calibrated survey accuracy figure.

import { GNSS_CONFIG } from './config.js'
import { distanceToRingM, outerRing } from './geomUtils.js'

/**
 * Per-point boundary check against one parcel.
 * @returns {{ distanceM:number|null, verificationStatus:string, segmentIndex:number|null }}
 */
export function verifyPointAgainstParcel(point, parcel, config = GNSS_CONFIG) {
  const ring = outerRing(parcel?.geometry)
  if (!ring || ring.length < 4 || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return { distanceM: null, verificationStatus: 'INSUFFICIENT_DATA', segmentIndex: null }
  }
  const { distanceM: d, segmentIndex } = distanceToRingM([point.longitude, point.latitude], ring)
  let verificationStatus
  if (d <= config.boundaryToleranceM) verificationStatus = 'WITHIN_TOLERANCE'
  else if (d <= config.boundaryToleranceM * 3) verificationStatus = 'REVIEW_REQUIRED'
  else verificationStatus = 'OUTSIDE_TOLERANCE'
  return { distanceM: Number(d.toFixed(3)), verificationStatus, segmentIndex }
}

/**
 * Aggregate deviation statistics for a set of (point, distanceM) pairs
 * belonging to the same parcel.
 */
export function aggregateDeviations(distances) {
  const d = distances.filter((x) => Number.isFinite(x))
  if (!d.length) {
    return { count: 0, meanM: null, medianM: null, maxM: null, rmseM: null }
  }
  const sorted = [...d].sort((a, b) => a - b)
  const mean = d.reduce((s, x) => s + x, 0) / d.length
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const max = sorted[sorted.length - 1]
  const rmse = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)
  return {
    count: d.length,
    meanM: Number(mean.toFixed(3)),
    medianM: Number(median.toFixed(3)),
    maxM: Number(max.toFixed(3)),
    rmseM: Number(rmse.toFixed(3)),
  }
}

/**
 * Full boundary verification for one parcel against a set of control points.
 * @param {object} parcel
 * @param {object[]} points  control-point docs with latitude/longitude
 * @param {object} [config]
 */
export function verifyParcelBoundary(parcel, points, config = GNSS_CONFIG) {
  const perPoint = points.map((p) => ({
    controlPointId: p.controlPointId,
    ...verifyPointAgainstParcel(p, parcel, config),
  }))
  const deviations = aggregateDeviations(perPoint.map((p) => p.distanceM))

  let verificationStatus
  if (deviations.count < 2) verificationStatus = 'INSUFFICIENT_DATA'
  else if (deviations.maxM <= config.boundaryToleranceM) verificationStatus = 'WITHIN_TOLERANCE'
  else if (deviations.maxM > config.boundaryToleranceM * 3) verificationStatus = 'OUTSIDE_TOLERANCE'
  else verificationStatus = 'REVIEW_REQUIRED'

  return {
    parcelId: parcel.parcelId,
    ulpin: parcel.ulpin,
    tolerance: config.boundaryToleranceM,
    verificationStatus,
    deviations,
    points: perPoint,
    note: 'OBSERVED DEVIATION from the existing parcel boundary — not an official cadastral correction. Existing parcel geometry is unchanged.',
  }
}
