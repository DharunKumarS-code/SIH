// ---------------------------------------------------------------------------
// Reversible integration of an ACCEPTED elevation-derived building height into
// the EXISTING Phase-2 geometry (spec sections 13-16). This never creates a
// second volume model — it directly edits the same baseElevationM/heightM
// (building) and baseHeight/topHeight (floor/unit) fields the existing
// geometry3d volume helpers already read, so buildingVolume()/floorVolume()/
// unitVolume() pick the change up automatically.
//
// The mapping is a uniform affine rescale of z, anchored at the new ground
// elevation, so floor ordering, floor thickness ratios and unit containment
// are all preserved (only the vertical scale/offset changes — x/y never do):
//
//   scale  = newHeight / oldHeight
//   z'     = newGroundElevation + (z - oldBaseElevation) * scale
//
// The very first time an override is applied, the pre-existing (demo/estimated)
// values are copied into an `elevationOriginal` field on each doc — never
// overwritten again — so `revertElevationOverride` can always restore the
// exact original geometry. Nothing is ever deleted.
// ---------------------------------------------------------------------------

import { db } from '../../store/index.js'
import { recordAudit } from '../auditService.js'

const round3 = (n) => Number(n.toFixed(3))

/**
 * Apply an ACCEPTED buildingHeights result onto the building/floors/units.
 * Only call this from an explicit, permissioned review action — never
 * automatically. Returns the updated building doc, or null if not applicable.
 */
export async function applyElevationOverride(buildingId, heightResult, user, ip = null) {
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) return null

  const G1 = heightResult.groundElevationM
  const H1 = heightResult.buildingHeightM
  if (!Number.isFinite(G1) || !Number.isFinite(H1) || H1 <= 0) return null

  const B0 = building.elevationOriginal?.baseElevationM ?? building.baseElevationM ?? 0
  const H0 = building.elevationOriginal?.heightM ?? building.heightM ?? 0
  if (!(H0 > 0)) return null
  const scale = H1 / H0
  const remap = (z) => round3(G1 + (z - B0) * scale)

  if (!building.elevationOriginal) {
    await db.collection('buildings').updateOne({ buildingId }, {
      elevationOriginal: { baseElevationM: building.baseElevationM, heightM: building.heightM },
    })
  }
  const updatedBuilding = await db.collection('buildings').updateOne({ buildingId }, {
    baseElevationM: round3(G1),
    heightM: round3(H1),
    elevationOverrideActive: true,
    elevationSource: heightResult.dataSource || 'LIDAR_DERIVED',
    elevationConfidenceLevel: heightResult.confidenceLevel,
    elevationQualityStatus: heightResult.qualityStatus,
    elevationRoofElevationM: heightResult.roofElevationM,
    elevationAppliedAt: new Date().toISOString(),
    elevationAppliedBy: user?.username || null,
  })

  // One combined update per doc (skip the separate elevationOriginal-backup
  // round-trip) and issue them concurrently — sequential awaits here would
  // mean one Atlas round-trip per floor/unit (seconds for a real building).
  const floors = await db.collection('floors').find({ buildingId })
  await Promise.all(floors.map((f) => {
    const original = f.elevationOriginal || { baseHeight: f.baseHeight, topHeight: f.topHeight }
    return db.collection('floors').updateOne({ floorId: f.floorId }, {
      elevationOriginal: original,
      baseHeight: remap(original.baseHeight), topHeight: remap(original.topHeight),
      elevationAdjusted: true, elevationSource: heightResult.dataSource || 'LIDAR_DERIVED',
    })
  }))

  const units = await db.collection('propertyUnits').find({ buildingId })
  await Promise.all(units.map((u) => {
    const original = u.elevationOriginal || { baseHeight: u.baseHeight, topHeight: u.topHeight }
    return db.collection('propertyUnits').updateOne({ propertyId: u.propertyId }, {
      elevationOriginal: original,
      baseHeight: remap(original.baseHeight), topHeight: remap(original.topHeight),
      elevationAdjusted: true, elevationSource: heightResult.dataSource || 'LIDAR_DERIVED',
    })
  }))

  await recordAudit({
    user: user?.username,
    action: 'BUILDING_ELEVATION_HEIGHT_APPLIED',
    entityType: 'Building',
    entityId: buildingId,
    before: { baseElevationM: B0, heightM: H0 },
    after: { baseElevationM: G1, heightM: H1 },
    ip,
  })

  return updatedBuilding
}

/** Reversal — restores the exact pre-override geometry on every affected doc. */
export async function revertElevationOverride(buildingId, user, ip = null) {
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building?.elevationOriginal) return building || null

  const updatedBuilding = await db.collection('buildings').updateOne({ buildingId }, {
    baseElevationM: building.elevationOriginal.baseElevationM,
    heightM: building.elevationOriginal.heightM,
    elevationOverrideActive: false,
  })

  const floors = await db.collection('floors').find({ buildingId })
  await Promise.all(floors.filter((f) => f.elevationOriginal).map((f) =>
    db.collection('floors').updateOne({ floorId: f.floorId }, {
      baseHeight: f.elevationOriginal.baseHeight, topHeight: f.elevationOriginal.topHeight, elevationAdjusted: false,
    })))
  const units = await db.collection('propertyUnits').find({ buildingId })
  await Promise.all(units.filter((u) => u.elevationOriginal).map((u) =>
    db.collection('propertyUnits').updateOne({ propertyId: u.propertyId }, {
      baseHeight: u.elevationOriginal.baseHeight, topHeight: u.elevationOriginal.topHeight, elevationAdjusted: false,
    })))

  await recordAudit({
    user: user?.username,
    action: 'BUILDING_ELEVATION_HEIGHT_REVERTED',
    entityType: 'Building',
    entityId: buildingId,
    before: { baseElevationM: building.baseElevationM, heightM: building.heightM },
    after: building.elevationOriginal,
    ip,
  })

  return updatedBuilding
}
