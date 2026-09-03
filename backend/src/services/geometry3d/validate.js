// ---------------------------------------------------------------------------
// Deterministic geometric validation for prototype 3D volumes (Phase 2).
//
// This is plain rule-based geometry checking — NOT AI, NOT a legal cadastral
// validation. Each rule yields VALID | WARNING | ERROR with a `rule` slug and a
// human-readable `message`. See docs/14 for the rule catalogue.
// ---------------------------------------------------------------------------

import {
  volumeFromFootprint, deriveVolumeId, toMetreBox, volumeRef, boxContains, boxOverlapM2,
  GEOMETRY_TOLERANCE_M, Z_TOLERANCE_M, MIN_STOREY_M, MAX_STOREY_M,
} from './volume.js'

export const STATUS = { VALID: 'VALID', WARNING: 'WARNING', ERROR: 'ERROR' }

// worst-of rollup: ERROR beats WARNING beats VALID
const RANK = { VALID: 0, WARNING: 1, ERROR: 2 }
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a)
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

const issue = (level, id, status, rule, message) => ({ level, id, status, rule, message })

// WARNING band (metres beyond tolerance) before a containment miss becomes an
// ERROR. Parcels/buildings are coarse cadastral approximations, so the
// building→parcel band is wider than the unit→building band.
const WARN_BAND_M = { UNIT_INSIDE_BUILDING: GEOMETRY_TOLERANCE_M * 4, BUILDING_INSIDE_PARCEL: GEOMETRY_TOLERANCE_M * 12 }

/** Rules 1, 2, 3, 4: intrinsic checks on a single volume box. */
function intrinsicIssues(level, id, v) {
  const out = []
  if (!v || !finite(v.xmin) || !finite(v.xmax) || !finite(v.ymin) || !finite(v.ymax) || !finite(v.zmin) || !finite(v.zmax)) {
    out.push(issue(level, id, STATUS.ERROR, 'VOLUME_COORDS_PRESENT', `${level} ${id}: one or more volume bounds are missing.`))
    return out
  }
  if (!(v.zmin < v.zmax)) {
    out.push(issue(level, id, STATUS.ERROR, 'Z_MIN_LT_Z_MAX', `${level} ${id}: zmin (${v.zmin}) is not below zmax (${v.zmax}).`))
  }
  const h = v.zmax - v.zmin
  if (!(h > 0)) {
    out.push(issue(level, id, STATUS.ERROR, 'HEIGHT_POSITIVE', `${level} ${id}: height is not positive (${h.toFixed(2)} m).`))
  } else if ((level === 'Floor' || level === 'Unit') && (h < MIN_STOREY_M - 1e-6 || h > MAX_STOREY_M + 1e-6)) {
    // storey sanity — only single-storey volumes; a whole building is expected to be tall
    out.push(issue(level, id, STATUS.WARNING, 'HEIGHT_WITHIN_BOUNDS', `${level} ${id}: storey height ${h.toFixed(2)} m is outside the plausible range ${MIN_STOREY_M}–${MAX_STOREY_M} m.`))
  }
  return out
}

/** Containment of `inner` volume inside `outer` volume, graded by how far out. */
function containmentIssue(level, id, rule, inner, outer, outerLabel) {
  const ref = volumeRef(outer) // shared origin so float scale differences cancel
  const im = toMetreBox(inner, ref)
  const om = toMetreBox(outer, ref)
  if (!im || !om) return null
  const { inside, maxOutM } = boxContains(om, im, GEOMETRY_TOLERANCE_M)
  if (inside) return null
  const status = maxOutM <= (WARN_BAND_M[rule] ?? GEOMETRY_TOLERANCE_M * 4) ? STATUS.WARNING : STATUS.ERROR
  return issue(
    level, id, status, rule,
    `${level} ${id} extends ${maxOutM.toFixed(2)} m outside ${outerLabel} (tolerance ${GEOMETRY_TOLERANCE_M} m).`,
  )
}

/**
 * Validate one unit against its building (used by GET /api/units/:id).
 * `unit` / `building` are raw DB docs (with geometry + heights).
 */
export function validateUnitVolume(unit, building) {
  const uv = volumeFromFootprint(unit.geometry, unit.baseHeight, unit.topHeight, {
    volumeId: deriveVolumeId('unit', unit),
  })
  const issues = intrinsicIssues('Unit', unit.unitId || unit.propertyId, uv)
  if (building?.geometry) {
    const bv = volumeFromFootprint(
      building.geometry,
      building.baseElevationM ?? 0,
      (building.baseElevationM ?? 0) + (building.heightM ?? 0),
      { volumeId: deriveVolumeId('building', building) },
    )
    const c = containmentIssue('Unit', unit.unitId || unit.propertyId, 'UNIT_INSIDE_BUILDING', uv, bv, `Building ${building.buildingSegment || building.buildingId}`)
    if (c) issues.push(c)
  }
  const status = issues.reduce((s, i) => worst(s, i.status), STATUS.VALID)
  return { status, issues, volumeId: uv?.volumeId || null }
}

/**
 * Full parcel validation (used by GET /api/parcels/:id and /volumes).
 * All args are arrays of raw DB docs; `parcel` is a single doc.
 */
export function validateParcelVolumes({ parcel, buildings = [], floors = [], units = [] }) {
  const issues = []

  const parcelVol = parcel?.geometry ? volumeFromFootprint(parcel.geometry, 0, 1) : null

  for (const b of buildings) {
    const bv = volumeFromFootprint(
      b.geometry, b.baseElevationM ?? 0, (b.baseElevationM ?? 0) + (b.heightM ?? 0),
      { volumeId: deriveVolumeId('building', b) },
    )
    issues.push(...intrinsicIssues('Building', b.buildingSegment || b.buildingId, bv))
    if (parcelVol) {
      const c = containmentIssue('Building', b.buildingSegment || b.buildingId, 'BUILDING_INSIDE_PARCEL', bv, parcelVol, `Parcel ${parcel.parcelId || parcel.ulpin}`)
      if (c) issues.push(c)
    }

    // Rule 7 — floor z-ranges ordered & non-overlapping within this building
    const bFloors = floors
      .filter((f) => f.buildingId === b.buildingId)
      .sort((x, y) => x.floorNumber - y.floorNumber)
    for (let i = 0; i < bFloors.length; i += 1) {
      const f = bFloors[i]
      const fv = volumeFromFootprint(b.geometry, f.baseHeight, f.topHeight, { volumeId: deriveVolumeId('floor', f) })
      issues.push(...intrinsicIssues('Floor', `${b.buildingSegment}/${f.floorSegment}`, fv))
      if (i > 0) {
        const prev = bFloors[i - 1]
        if (f.baseHeight + Z_TOLERANCE_M < prev.topHeight) {
          issues.push(issue(
            'Floor', `${b.buildingSegment}/${f.floorSegment}`, STATUS.WARNING, 'FLOOR_RANGE_ORDER',
            `Floor ${f.floorSegment} (${f.baseHeight}–${f.topHeight} m) overlaps floor ${prev.floorSegment} (${prev.baseHeight}–${prev.topHeight} m).`,
          ))
        }
      }
    }

    // Rule 8 — units on the same floor must not overlap horizontally
    const bUnits = units.filter((u) => u.buildingId === b.buildingId)
    const byFloor = new Map()
    for (const u of bUnits) {
      if (!byFloor.has(u.floorNumber)) byFloor.set(u.floorNumber, [])
      byFloor.get(u.floorNumber).push(u)
    }
    const bRef = volumeRef(bv) // shared origin for all units in this building
    for (const [, fu] of byFloor) {
      const boxes = fu.map((u) => ({
        u,
        m: toMetreBox(volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight), bRef),
      }))
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const ov = boxOverlapM2(boxes[i].m, boxes[j].m)
          if (ov > GEOMETRY_TOLERANCE_M * GEOMETRY_TOLERANCE_M) {
            issues.push(issue(
              'Unit', `${boxes[i].u.unitId} / ${boxes[j].u.unitId}`, STATUS.WARNING, 'UNIT_NO_OVERLAP',
              `Units ${boxes[i].u.unitId} and ${boxes[j].u.unitId} on ${b.buildingSegment}/F${String(boxes[i].u.floorNumber).padStart(2, '0')} overlap by ${ov.toFixed(1)} m².`,
            ))
          }
        }
      }
    }

    // Rule 5 — every unit inside its building
    for (const u of bUnits) {
      const uv = volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight, { volumeId: deriveVolumeId('unit', u) })
      issues.push(...intrinsicIssues('Unit', u.unitId, uv))
      const c = containmentIssue('Unit', u.unitId, 'UNIT_INSIDE_BUILDING', uv, bv, `Building ${b.buildingSegment}`)
      if (c) issues.push(c)
    }
  }

  const counts = { valid: 0, warning: 0, error: 0 }
  for (const i of issues) counts[i.status.toLowerCase()] += 1
  const status = issues.reduce((s, i) => worst(s, i.status), STATUS.VALID)
  return { status, counts, issues }
}
