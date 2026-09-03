// Prototype 3D volume model — barrel + assembly helpers (Phase 2).

export {
  volumeFromFootprint, volumeMetrics, deriveVolumeId, parseVolumeId,
  toMetreBox, volumeRef, boxContains, boxOverlapM2,
  GEOMETRY_TOLERANCE_M, Z_TOLERANCE_M, MIN_STOREY_M, MAX_STOREY_M,
} from './volume.js'
export { validateParcelVolumes, validateUnitVolume, STATUS } from './validate.js'

import { volumeFromFootprint, deriveVolumeId } from './volume.js'
import { validateParcelVolumes } from './validate.js'

/** Volume block for a building (footprint + full building z-extent). */
export const buildingVolume = (b, source = 'DEMO') =>
  b?.geometry
    ? volumeFromFootprint(
        b.geometry,
        b.baseElevationM ?? 0,
        (b.baseElevationM ?? 0) + (b.heightM ?? 0),
        { volumeId: deriveVolumeId('building', b), source },
      )
    : null

/** Volume block for a floor — horizontal extent = its parent building footprint. */
export const floorVolume = (floor, building, source = 'DEMO') =>
  building?.geometry
    ? volumeFromFootprint(building.geometry, floor?.baseHeight, floor?.topHeight, {
        volumeId: deriveVolumeId('floor', floor || {}),
        source,
      })
    : null

/** Volume block for a unit — its own footprint + baseHeight/topHeight. */
export const unitVolume = (u, source = 'DEMO') =>
  u?.geometry
    ? volumeFromFootprint(u.geometry, u.baseHeight, u.topHeight, {
        volumeId: deriveVolumeId('unit', u),
        source,
      })
    : null

/**
 * Assemble every prototype volume for a parcel + a validation rollup.
 * @param {{parcel, buildings, floors, units, source}} data raw DB docs
 */
export function assembleParcelVolumes({ parcel, buildings = [], floors = [], units = [], source = 'DEMO' }) {
  const validation = validateParcelVolumes({ parcel, buildings, floors, units })
  const statusFor = (level, id) => {
    const hit = validation.issues.find((i) => i.level === level && String(i.id).includes(id))
    return hit ? hit.status : 'VALID'
  }
  return {
    volumes: {
      buildings: buildings.map((b) => ({
        buildingId: b.buildingId,
        ...buildingVolume(b, source),
        status: statusFor('Building', b.buildingSegment || b.buildingId),
      })),
      floors: floors.map((f) => {
        const b = buildings.find((x) => x.buildingId === f.buildingId)
        return {
          floorId: f.floorId,
          buildingId: f.buildingId,
          ...floorVolume(f, b, source),
          status: statusFor('Floor', f.floorSegment),
        }
      }),
      units: units.map((u) => ({
        propertyId: u.propertyId,
        unitId: u.unitId,
        buildingId: u.buildingId,
        floorId: u.floorId,
        ...unitVolume(u, source),
        status: statusFor('Unit', u.unitId),
      })),
    },
    validation,
  }
}
