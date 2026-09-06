// Phase 8 — spatial association of an underground infrastructure object with
// the existing demo parcels and buildings of a locality (spec sections 11-12).
//
// CRITICAL: this records GEOMETRY FACTS ONLY. A spatial relationship is NEVER
// converted into a legal ownership claim. `legalOwnership` stays NOT_PROVIDED
// unless authoritative data supplies it; `ownerAuthority` is a separate,
// independent field carried straight from the source dataset.
//
//   Parcel relations : WITHIN_PARCEL | CROSSES_PARCEL | NEAR_PARCEL
//   Building relations: UNDER_BUILDING | CROSSES_BUILDING | NEAR_BUILDING
//
// "A pipeline intersects Parcel A" does NOT mean "Parcel A owns the pipeline"
// (spec section 11).

import { UNDERGROUND_CONFIG, LEGAL_OWNERSHIP_NOT_PROVIDED } from './config.js'
import {
  geomShape, outerRing, pointInRing, pointToRingM, distM,
} from './geometry.js'

function vertsOf(shape) {
  if (!shape) return []
  return shape.kind === 'point' ? [shape.coord] : shape.kind === 'line' ? shape.coords : shape.ring
}

/** Relationship of one infra shape to one polygon ring. */
function relateToRing(verts, ring, tolM) {
  let anyInside = false
  let anyOutside = false
  let nearest = Infinity
  for (const v of verts) {
    const inside = pointInRing(v, ring)
    if (inside) anyInside = true
    else anyOutside = true
    const d = pointToRingM(v, ring)
    if (d < nearest) nearest = d
  }
  if (anyInside && anyOutside) return { relation: 'CROSSES', nearestBoundaryM: Number(nearest.toFixed(3)) }
  if (anyInside) return { relation: 'WITHIN', nearestBoundaryM: Number(nearest.toFixed(3)) }
  if (nearest <= tolM) return { relation: 'NEAR', nearestBoundaryM: Number(nearest.toFixed(3)) }
  return null
}

/**
 * @param {object} rec           infra record (.geometry, .parentParcel?, .parentBuilding?, .ownerAuthority?, .legalOwnership?)
 * @param {object[]} parcels     parcel docs for the locality
 * @param {object[]} buildings   building docs for the locality
 * @param {object} [config]
 * @returns spatialRelation summary — geometry facts only, NEVER legal ownership.
 */
export function associate(rec, parcels = [], buildings = [], config = UNDERGROUND_CONFIG) {
  const shape = geomShape(rec)
  const verts = vertsOf(shape)

  const parcelRelations = []
  for (const p of parcels) {
    const ring = outerRing(p.geometry)
    if (!ring || ring.length < 4) continue
    const r = relateToRing(verts, ring, config.nearParcelToleranceM)
    if (!r) continue
    parcelRelations.push({
      parcelId: p.parcelId,
      ulpin: p.ulpin,
      spatialRelation: `${r.relation}_PARCEL`,
      nearestBoundaryM: r.nearestBoundaryM,
    })
  }
  parcelRelations.sort((a, b) => a.nearestBoundaryM - b.nearestBoundaryM)

  const buildingRelations = []
  for (const b of buildings) {
    const ring = outerRing(b.geometry)
    if (!ring || ring.length < 4) continue
    const r = relateToRing(verts, ring, config.nearBuildingToleranceM)
    if (!r) continue
    const rel = r.relation === 'WITHIN' ? 'UNDER_BUILDING' : r.relation === 'CROSSES' ? 'CROSSES_BUILDING' : 'NEAR_BUILDING'
    buildingRelations.push({ buildingId: b.buildingId, ulpin: b.ulpin, spatialRelation: rel, nearestBoundaryM: r.nearestBoundaryM })
  }
  buildingRelations.sort((a, b) => a.nearestBoundaryM - b.nearestBoundaryM)

  // The single "primary" parcel/building is the innermost spatial relation —
  // this is a spatial pointer for navigation, NOT an ownership assignment.
  const primaryParcel = parcelRelations.find((r) => r.spatialRelation === 'WITHIN_PARCEL')
    || parcelRelations.find((r) => r.spatialRelation === 'CROSSES_PARCEL')
    || parcelRelations[0]
    || null
  const primaryBuilding = buildingRelations.find((r) => r.spatialRelation === 'UNDER_BUILDING')
    || buildingRelations[0]
    || null

  return {
    // spatial facts
    spatialRelation: primaryParcel?.spatialRelation || 'OUTSIDE_PROJECT_AREA',
    parentParcel: rec.parentParcel || primaryParcel?.parcelId || null,
    parentParcelULPIN: primaryParcel?.ulpin || null,
    parentBuilding: rec.parentBuilding || primaryBuilding?.buildingId || null,
    parcelRelations,
    buildingRelations,
    // legal facts — populated ONLY from authoritative data, never from geometry
    ownerAuthority: rec.ownerAuthority || null,
    legalOwnership: rec.legalOwnership || LEGAL_OWNERSHIP_NOT_PROVIDED,
  }
}
