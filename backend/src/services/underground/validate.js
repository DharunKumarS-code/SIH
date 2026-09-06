// Phase 8 — deterministic validation rules for underground infrastructure.
//
// This REUSES and EXTENDS the Phase 7 topology validation engine rather than
// introducing an unrelated framework (spec section 18):
//   - the STATUS / SEVERITY vocabulary and worst-of reducers come straight from
//     services/topology/severity.js;
//   - a finding has the SAME extensible result shape as a Phase 7 finding
//     (spec section 21): validationId, ruleId, status, severity, entityType,
//     entityId, parentEntity, relatedEntity, message, geometry, suggestedFix,
//     computedValue, tolerance, provenance, createdAt;
//   - a finding NEVER modifies stored geometry — suggestedFix is guidance for a
//     separate, explicit review action only.
//
// Only the RULES themselves are new and infrastructure-specific.

import { STATUS, SEVERITY, worstStatus, worstSeverity } from '../topology/severity.js'
import {
  UNDERGROUND_CONFIG, INFRA_TYPES, DIAMETER_TYPES, RECT_TYPES, LINEAR_TYPES,
  POINT_TYPES, VOLUMETRIC_TYPES, normaliseType,
} from './config.js'
import {
  finite, geomShape, polylineLengthM, polylineSelfIntersects, distM, outerRing,
  verticalBand, intersection3D, bboxOverlaps,
} from './geometry.js'

export { STATUS, SEVERITY }

const RANK = { VALID: 0, WARNING: 1, REVIEW_REQUIRED: 2, ERROR: 3 }
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a)

// Rule id -> default { status, severity }. Per-instance overrides are allowed
// (e.g. a missing-depth on a DEMO record is only REVIEW_REQUIRED).
export const INF_RULE_DEFAULTS = {
  // geometry
  INF_EMPTY_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.CRITICAL },
  INF_INVALID_GEOMETRY: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_INVALID_COORDINATES: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_SELF_INTERSECTION: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_DEGENERATE_GEOMETRY: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  INF_GEOMETRY_TYPE_MISMATCH: { status: STATUS.WARNING, severity: SEVERITY.LOW },
  INF_UNCONTROLLED_TYPE: { status: STATUS.WARNING, severity: SEVERITY.LOW },
  // dimensions
  INF_INVALID_DIAMETER: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  INF_INVALID_DIMENSIONS: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  INF_DUPLICATE_ID: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_DUPLICATE_GEOMETRY: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  // vertical
  INF_INVALID_Z: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_MISSING_DEPTH: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.MEDIUM },
  INF_INVALID_DEPTH: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  INF_VERTICAL_DATUM_UNKNOWN: { status: STATUS.WARNING, severity: SEVERITY.LOW },
  INF_DEPTH_SURFACE_CONFLICT: { status: STATUS.ERROR, severity: SEVERITY.MEDIUM },
  // CRS
  INF_CRS_UNKNOWN: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.MEDIUM },
  INF_CRS_MISMATCH: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  INF_TRANSFORMATION_FAILED: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  // spatial
  INF_OUTSIDE_PROJECT_AREA: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_UNEXPECTED_PARCEL_RELATION: { status: STATUS.WARNING, severity: SEVERITY.LOW },
  INF_UNEXPECTED_BUILDING_RELATION: { status: STATUS.WARNING, severity: SEVERITY.MEDIUM },
  // provenance
  INF_MISSING_PROVENANCE: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.MEDIUM },
  // 3D
  INF_3D_COLLISION: { status: STATUS.ERROR, severity: SEVERITY.HIGH },
  INF_2D_INTERSECTION_VERTICALLY_CLEAR: { status: STATUS.VALID, severity: SEVERITY.LOW },
  INF_CLEARANCE_REVIEW: { status: STATUS.REVIEW_REQUIRED, severity: SEVERITY.LOW },
}

let seq = Date.now() % 1_000_000
const nextValidationId = () => {
  seq += 1
  return `IVFIND-${Date.now().toString(36).toUpperCase()}-${String(seq).padStart(6, '0')}`
}

/** Build one finding with the Phase 7 result shape (spec section 21). */
export function makeFinding(f) {
  const d = INF_RULE_DEFAULTS[f.ruleId] || { status: STATUS.WARNING, severity: SEVERITY.MEDIUM }
  return {
    validationId: nextValidationId(),
    ruleId: f.ruleId,
    status: f.status || d.status,
    severity: f.severity || d.severity,
    entityType: f.entityType || 'INFRASTRUCTURE',
    entityId: f.entityId,
    parentEntityId: f.parentEntityId ?? null,
    relatedEntityId: f.relatedEntityId ?? null,
    message: f.message,
    geometry: f.geometry ?? null,
    focusRef: f.focusRef ?? (f.entityId ? { kind: 'infrastructure', infrastructureId: f.entityId } : null),
    relatedFocusRef: f.relatedFocusRef ?? null,
    suggestedFix: f.suggestedFix ?? null,
    computedValue: Number.isFinite(f.computedValue) ? f.computedValue : null,
    tolerance: Number.isFinite(f.tolerance) ? f.tolerance : null,
    provenance: f.provenance ?? null, // the entity's own source — NEVER upgraded
    locality: f.locality ?? null,
    createdAt: new Date().toISOString(),
  }
}

const inRange = (n, lo, hi) => finite(n) && n >= lo && n <= hi

/**
 * Validate one already-parsed / already-stored infrastructure record.
 * Pure — no DB, no network. `context` may carry { localityCentres, parcels,
 * buildings } for spatial rules; all optional.
 * @returns {object[]} findings (empty when the record is clean)
 */
export function validateRecord(rec, context = {}, config = UNDERGROUND_CONFIG) {
  const out = []
  const id = rec.infrastructureId || '(unknown)'
  const prov = rec.source || rec.verificationStatus || null
  const push = (o) => out.push(makeFinding({ entityId: id, provenance: prov, locality: rec.locality || null, ...o }))

  // ---- provenance (spec section 4) ----
  if (!rec.source && !rec.verificationStatus) {
    push({ ruleId: 'INF_MISSING_PROVENANCE', message: `Infrastructure ${id} has no source/verificationStatus — provenance is mandatory.`, suggestedFix: 'Supply an explicit source classification (DEMO / AUTHORIZED / …).' })
  }

  // ---- controlled type (spec section 6) ----
  if (rec.type && !INFRA_TYPES.includes(rec.type)) {
    push({ ruleId: 'INF_UNCONTROLLED_TYPE', message: `Type "${rec.type}" is not in the controlled list — normalised to OTHER.`, suggestedFix: `Use one of: ${INFRA_TYPES.join(', ')}.` })
  }
  const type = normaliseType(rec.type)

  // ---- geometry ----
  const shape = geomShape(rec)
  if (!rec.geometry) {
    push({ ruleId: 'INF_EMPTY_GEOMETRY', message: `Infrastructure ${id} has no geometry.` })
  } else if (!shape) {
    push({ ruleId: 'INF_INVALID_GEOMETRY', message: `Infrastructure ${id} geometry is not a usable Point / LineString / Polygon.` })
  } else {
    const coords = shape.kind === 'point' ? [shape.coord] : shape.kind === 'line' ? shape.coords : shape.ring
    const badCoord = coords.find((c) => !Array.isArray(c) || !inRange(c[0], config.lonMin, config.lonMax) || !inRange(c[1], config.latMin, config.latMax))
    if (badCoord) {
      push({ ruleId: 'INF_INVALID_COORDINATES', message: `Infrastructure ${id} has a coordinate outside valid lon/lat ranges.` })
    }
    if (shape.kind === 'line') {
      if (polylineSelfIntersects(shape.coords)) {
        push({ ruleId: 'INF_SELF_INTERSECTION', message: `Linear infrastructure ${id} self-intersects.` })
      }
      const len = polylineLengthM(shape.coords)
      if (len < config.minSegmentLengthM) {
        push({ ruleId: 'INF_DEGENERATE_GEOMETRY', message: `Linear infrastructure ${id} is only ${len.toFixed(2)} m long (min ${config.minSegmentLengthM} m).`, computedValue: Number(len.toFixed(3)), tolerance: config.minSegmentLengthM })
      }
    }
    if (shape.kind === 'ring') {
      const ring = shape.ring
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (distM(first, last) > 0.5) {
        push({ ruleId: 'INF_INVALID_GEOMETRY', message: `Polygon infrastructure ${id} ring is not closed.` })
      }
    }
    // type / geometry-kind mismatch (WARNING only — never a rejection)
    const kindOk = (LINEAR_TYPES.has(type) && shape.kind === 'line')
      || (POINT_TYPES.has(type) && shape.kind === 'point')
      || (VOLUMETRIC_TYPES.has(type) && (shape.kind === 'ring' || shape.kind === 'line'))
      || (type === 'CHAMBER' && shape.kind === 'ring')
      || (type === 'MANHOLE' && shape.kind === 'ring')
      || (type === 'OTHER')
    if (!kindOk) {
      push({ ruleId: 'INF_GEOMETRY_TYPE_MISMATCH', message: `${type} is normally supplied as ${LINEAR_TYPES.has(type) ? 'a LineString' : POINT_TYPES.has(type) ? 'a Point' : 'a Polygon'}, but geometry is ${shape.kind}.` })
    }
  }

  // ---- dimensions (spec section 5) ----
  if (rec.diameterM != null) {
    if (!inRange(rec.diameterM, config.minDiameterM, config.maxDiameterM)) {
      push({ ruleId: 'INF_INVALID_DIAMETER', message: `diameter ${rec.diameterM} m is outside the plausible range [${config.minDiameterM}, ${config.maxDiameterM}] m.`, computedValue: Number(rec.diameterM) || null, tolerance: config.maxDiameterM })
    }
  }
  for (const dim of ['widthM', 'heightM']) {
    if (rec[dim] != null && !inRange(rec[dim], config.minDimensionM, config.maxDimensionM)) {
      push({ ruleId: 'INF_INVALID_DIMENSIONS', message: `${dim} ${rec[dim]} m is outside the plausible range [${config.minDimensionM}, ${config.maxDimensionM}] m.`, computedValue: Number(rec[dim]) || null })
    }
  }
  if (RECT_TYPES.has(type) && rec.geometry && rec.widthM == null && rec.heightM == null && rec.diameterM == null && type !== 'CHAMBER') {
    // width/height simply not supplied is allowed — never fabricated. No finding.
  }

  // ---- vertical / depth (spec sections 8-9, 16) ----
  const band = verticalBand(rec)
  const depthKnown = band != null
  const isRealSource = ['OFFICIAL', 'AUTHORIZED', 'REAL_SURVEY', 'UPLOADED_SURVEY'].includes(rec.source)
  if (!depthKnown) {
    // No reliable Z. For a real source this is REVIEW_REQUIRED and depth MUST
    // stay null (spec section 9). For DEMO/RESEARCH it is only a WARNING.
    push({
      ruleId: 'INF_MISSING_DEPTH',
      status: isRealSource ? STATUS.REVIEW_REQUIRED : STATUS.WARNING,
      message: `Infrastructure ${id} has no reliable depth/elevation — depth and elevation are reported as null (never invented).`,
      suggestedFix: 'Attach surveyed top/bottom elevation, or surfaceElevation + depthBelowSurface, from an authoritative dataset.',
    })
  } else {
    if (band.bottom > band.top) {
      push({ ruleId: 'INF_INVALID_Z', message: `Infrastructure ${id} vertical band is inverted (bottom ${band.bottom} m > top ${band.top} m).` })
    }
    if (finite(rec.depthBelowSurfaceM)) {
      if (rec.depthBelowSurfaceM < 0) {
        push({ ruleId: 'INF_INVALID_DEPTH', message: `depthBelowSurface ${rec.depthBelowSurfaceM} m is negative — an underground asset must have a non-negative depth.` })
      } else if (rec.depthBelowSurfaceM > config.maxDepthBelowSurfaceM) {
        push({ ruleId: 'INF_INVALID_DEPTH', message: `depthBelowSurface ${rec.depthBelowSurfaceM} m exceeds the plausible maximum (${config.maxDepthBelowSurfaceM} m).`, computedValue: Number(rec.depthBelowSurfaceM), tolerance: config.maxDepthBelowSurfaceM })
      }
      // DEPTH_SURFACE_CONFLICT: a positive depth-below-surface whose implied
      // crown would sit ABOVE the stated surface elevation.
      if (finite(rec.surfaceElevationM) && finite(rec.topElevationM) &&
          rec.topElevationM - (rec.surfaceElevationM - rec.depthBelowSurfaceM) > config.depthSurfaceToleranceM) {
        push({ ruleId: 'INF_DEPTH_SURFACE_CONFLICT', message: `topElevation (${rec.topElevationM} m) is inconsistent with surfaceElevation ${rec.surfaceElevationM} m minus depthBelowSurface ${rec.depthBelowSurfaceM} m.` })
      }
    }
  }
  // Vertical datum: never silently assumed (spec section 16).
  const vd = String(rec.verticalDatum || '').trim().toUpperCase()
  if (depthKnown && (!vd || vd === 'UNKNOWN')) {
    push({ ruleId: 'INF_VERTICAL_DATUM_UNKNOWN', message: `Infrastructure ${id} reports a depth/elevation but no vertical datum — comparability with other vertical data is limited.` })
  }

  // ---- CRS (spec section 15) ----
  const crsStatus = rec.crsStatus || null
  const rawCrs = rec.crs || rec.inputCRS || null
  if (crsStatus === 'TRANSFORMATION_FAILED') {
    push({ ruleId: 'INF_TRANSFORMATION_FAILED', message: `Infrastructure ${id}: CRS transform (${rec.inputCRS || rec.crs} -> ${rec.outputCRS || 'EPSG:4326'}) failed or is unavailable — no coordinate was fabricated.` })
  } else if (!rawCrs && crsStatus !== 'MATCHED' && crsStatus !== 'REPROJECTED') {
    push({ ruleId: 'INF_CRS_UNKNOWN', message: `Infrastructure ${id} has no coordinateReferenceSystem — treated as UNKNOWN, never assumed WGS84. Authoritative placement is blocked until reviewed.` })
  } else if (context.batchCrs && rawCrs && context.batchCrs !== rawCrs && crsStatus !== 'REPROJECTED') {
    push({ ruleId: 'INF_CRS_MISMATCH', message: `Infrastructure ${id} declares CRS "${rawCrs}" but the batch was imported as "${context.batchCrs}".` })
  }

  // ---- spatial (spec sections 12, 18) ----
  if (Array.isArray(context.localityCentres) && shape) {
    const coords = shape.kind === 'point' ? [shape.coord] : shape.kind === 'line' ? shape.coords : shape.ring
    const anyInside = coords.some((c) => context.localityCentres.some((lc) => distM(c, [lc.lon, lc.lat]) <= config.projectAreaRadiusM))
    if (!anyInside) {
      push({ ruleId: 'INF_OUTSIDE_PROJECT_AREA', message: `Infrastructure ${id} lies entirely outside every known Chennai locality (> ${config.projectAreaRadiusM} m).` })
    }
  }
  // "Utilities can legitimately pass beneath parcels" (spec section 18) — a
  // plain parcel intersection is NEVER an error. Only an EXPLICITLY declared
  // parentBuilding that the geometry does not actually reach is flagged.
  if (rec.parentBuilding && context.buildingsById) {
    const b = context.buildingsById.get(rec.parentBuilding)
    if (b) {
      const ring = outerRing(b.geometry)
      if (ring && shape) {
        const bb = [Math.min(...ring.map((r) => r[0])), Math.min(...ring.map((r) => r[1])), Math.max(...ring.map((r) => r[0])), Math.max(...ring.map((r) => r[1]))]
        if (!bboxOverlaps(shape.bbox, bb)) {
          push({ ruleId: 'INF_UNEXPECTED_BUILDING_RELATION', message: `Infrastructure ${id} declares parentBuilding ${rec.parentBuilding} but its geometry does not reach that building's footprint.` })
        }
      }
    }
  }

  return out
}

/**
 * Pairwise 3D intersection / clearance findings across a set of records
 * (spec sections 19-20). Uses bbox prefiltering so this is not a blind O(n²)
 * exact-geometry sweep.
 */
export function validateIntersections(records, config = UNDERGROUND_CONFIG) {
  const out = []
  const shaped = records
    .map((r) => ({ r, s: geomShape(r) }))
    .filter((x) => x.s)
  for (let i = 0; i < shaped.length; i += 1) {
    for (let j = i + 1; j < shaped.length; j += 1) {
      const A = shaped[i]
      const B = shaped[j]
      if (!bboxOverlaps(A.s.bbox, B.s.bbox)) continue
      const rel = intersection3D(A.r, A.s, B.r, B.s, config)
      if (rel.relationship === 'NO_INTERSECTION') continue
      const base = {
        entityId: A.r.infrastructureId,
        relatedEntityId: B.r.infrastructureId,
        relatedFocusRef: { kind: 'infrastructure', infrastructureId: B.r.infrastructureId },
        provenance: A.r.source || null,
        locality: A.r.locality || null,
        computedValue: rel.verticalSeparationM,
        geometry: { relationship: rel.relationship, horizontalSeparationM: rel.horizontalSeparationM, verticalSeparationM: rel.verticalSeparationM, verticalStatus: rel.verticalStatus, clearanceStatus: rel.clearanceStatus },
      }
      if (rel.relationship === '3D_COLLISION') {
        out.push(makeFinding({ ...base, ruleId: 'INF_3D_COLLISION', message: `${A.r.infrastructureId} and ${B.r.infrastructureId} intersect in plan AND their vertical bands overlap by ${Math.abs(rel.verticalSeparationM || 0)} m — a true 3D collision.`, suggestedFix: 'Verify surveyed depths; if correct, a physical conflict exists and must be resolved by the utility owners.' }))
      } else if (rel.relationship === '2D_INTERSECTION') {
        out.push(makeFinding({ ...base, ruleId: 'INF_2D_INTERSECTION_VERTICALLY_CLEAR', status: STATUS.VALID, message: `${A.r.infrastructureId} and ${B.r.infrastructureId} cross in plan but are vertically separated by ${rel.verticalSeparationM} m — NOT a 3D collision.` }))
        if (rel.clearanceStatus === 'REVIEW_REQUIRED' && rel.verticalSeparationM != null && rel.verticalSeparationM < config.clearanceNoticeM) {
          out.push(makeFinding({ ...base, ruleId: 'INF_CLEARANCE_REVIEW', message: `Measured vertical separation between ${A.r.infrastructureId} and ${B.r.infrastructureId} is only ${rel.verticalSeparationM} m. No authoritative clearance standard is configured — reported as measured, not judged an engineering violation.` }))
        }
      } else if (rel.relationship === 'INDETERMINATE_Z') {
        out.push(makeFinding({ ...base, ruleId: 'INF_CLEARANCE_REVIEW', status: STATUS.REVIEW_REQUIRED, message: `${A.r.infrastructureId} and ${B.r.infrastructureId} cross in plan, but at least one asset has no reliable Z — a 3D collision can neither be confirmed nor ruled out.` }))
      }
    }
  }
  return out
}

const ENTITY_TYPES = ['INFRASTRUCTURE']
const emptyBucket = () => ({ total: 0, valid: 0, warning: 0, error: 0, reviewRequired: 0 })

/** Aggregate findings into the Phase 7 summary shape (spec section 21). */
export function summarize(findings, entityCounts = {}) {
  const byEntity = Object.fromEntries(ENTITY_TYPES.map((t) => [t, emptyBucket()]))
  const byRule = {}
  const worstByEntityId = new Map()
  for (const f of findings) {
    const key = `${f.entityType}:${f.entityId}`
    if (f.status !== STATUS.VALID) worstByEntityId.set(key, worst(worstByEntityId.get(key) || STATUS.VALID, f.status))
    if (!byRule[f.ruleId]) byRule[f.ruleId] = { ruleId: f.ruleId, total: 0, warning: 0, error: 0, reviewRequired: 0 }
    byRule[f.ruleId].total += 1
    if (f.status === STATUS.WARNING) byRule[f.ruleId].warning += 1
    else if (f.status === STATUS.ERROR) byRule[f.ruleId].error += 1
    else if (f.status === STATUS.REVIEW_REQUIRED) byRule[f.ruleId].reviewRequired += 1
  }
  for (const [key, status] of worstByEntityId) {
    const t = key.slice(0, key.indexOf(':'))
    const bucket = byEntity[t]
    if (!bucket) continue
    if (status === STATUS.WARNING) bucket.warning += 1
    else if (status === STATUS.ERROR) bucket.error += 1
    else if (status === STATUS.REVIEW_REQUIRED) bucket.reviewRequired += 1
  }
  for (const t of ENTITY_TYPES) {
    const bucket = byEntity[t]
    const examined = entityCounts[t] ?? (bucket.warning + bucket.error + bucket.reviewRequired)
    bucket.total = examined
    bucket.valid = Math.max(0, examined - bucket.warning - bucket.error - bucket.reviewRequired)
  }
  const total = ENTITY_TYPES.reduce((acc, t) => {
    acc.total += byEntity[t].total
    acc.valid += byEntity[t].valid
    acc.warning += byEntity[t].warning
    acc.error += byEntity[t].error
    acc.reviewRequired += byEntity[t].reviewRequired
    return acc
  }, emptyBucket())
  const overallStatus = findings.reduce((s, f) => worstStatus(s, f.status), STATUS.VALID)
  const overallSeverity = findings
    .filter((f) => f.status !== STATUS.VALID)
    .reduce((s, f) => (s ? worstSeverity(s, f.severity) : f.severity), null)
  return { ...total, overallStatus, overallSeverity, byEntity, byRule }
}
