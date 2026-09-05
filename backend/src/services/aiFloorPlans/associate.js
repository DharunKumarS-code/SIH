// Building / floor association for AI floor-plan output (Phase 4, additive).
//
// A floor-plan image has NO geographic coordinates. Geometry stays in the LOCAL
// floor-plan reference UNLESS the caller supplies a real building (and,
// optionally, floor) from the existing Phase 1-2 data. When it does, we fit the
// floor-plan's local bounding box onto that building's footprint bounding box
// (a documented affine approximation) so units/rooms can be shown in the ONE
// Chennai Cesium viewer and validated against the building volume.
//
// This never invents a ULPIN: an associated unit carries the building's EXISTING
// parent parcel ULPIN (a Phase-1 value) with ulpinStatus 'DEMO_NOT_OFFICIAL'.

import { bbox } from '../../data/geo.js'
import {
  volumeFromFootprint,
  validateUnitVolume,
} from '../geometry3d/index.js'

const outerRing = (geometry) =>
  Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0]
    : Array.isArray(geometry?.[0]) ? geometry : null

/**
 * Build a local -> WGS84 transformer that maps the floor-plan bbox onto the
 * building footprint bbox. Image Y grows downward, latitude grows upward, so Y
 * is flipped.
 */
function fitTransform(localBox, buildingRing) {
  const [lminx, lminy, lmaxx, lmaxy] = localBox
  const [bminx, bminy, bmaxx, bmaxy] = bbox(buildingRing)
  const lw = lmaxx - lminx || 1
  const lh = lmaxy - lminy || 1
  const sx = (bmaxx - bminx) / lw
  const sy = (bmaxy - bminy) / lh
  return ([x, y]) => [
    bminx + (x - lminx) * sx,
    bmaxy - (y - lminy) * sy, // flip Y
  ]
}

const toGeoRing = (pixelPolygon, tf) => {
  if (!Array.isArray(pixelPolygon) || pixelPolygon.length < 3) return null
  const ring = pixelPolygon.map(tf)
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0])
  }
  return ring.map(([lon, lat]) => [Number(lon.toFixed(8)), Number(lat.toFixed(8))])
}

/**
 * @param {object} pyResult   the ai-service /floorplans/infer envelope
 * @param {object|null} building  buildings-collection doc (geometry + heights) or null
 * @param {object|null} floor     floors-collection doc (baseHeight/topHeight) or null
 * @param {string|null} parcelId
 * @param {string|null} parcelULPIN
 */
export function associateFloorPlan({ pyResult, building, floor, parcelId, parcelULPIN }) {
  const imgW = pyResult?.imageSize?.width || 0
  const imgH = pyResult?.imageSize?.height || 0
  // The Python `pixelPolygon` rings are ALWAYS in pixels (only the volume block
  // is scaled), so the local bbox we fit is the pixel extent of the image.
  const localBox = [0, 0, imgW, imgH]

  const buildingRing = building ? outerRing(building.geometry) : null
  const georeferenced = Boolean(buildingRing && buildingRing.length >= 4)

  const assoc = {
    georeferenced,
    geoStatus: georeferenced ? 'GEOREFERENCED_VIA_BUILDING' : 'NON_GEOREFERENCED_AI_DEMO',
    buildingId: building?.buildingId || null,
    floorId: floor?.floorId || null,
    parentParcelId: parcelId || null,
    parentULPIN: georeferenced ? (parcelULPIN || building?.ulpin || null) : null,
    ulpinStatus: 'DEMO_NOT_OFFICIAL',
    floorElevationM: null,
    floorHeightM: null,
    transformNote: georeferenced
      ? 'Local floor-plan bbox fitted onto the existing building footprint bbox (affine approximation).'
      : 'No building reference supplied — geometry kept in the local floor-plan coordinate system.',
  }

  // floor z-range (never fabricated — only from an existing floor record)
  if (floor) {
    const zmin = floor.volume?.zmin ?? floor.baseHeight ?? null
    const zmax = floor.volume?.zmax ?? floor.topHeight ?? null
    if (Number.isFinite(zmin) && Number.isFinite(zmax) && zmax > zmin) {
      assoc.floorElevationM = zmin
      assoc.floorHeightM = Number((zmax - zmin).toFixed(3))
    }
  }

  const tf = georeferenced ? fitTransform(localBox, buildingRing) : null

  // deterministic association-level validation (rules 7, 9, 10, 17 of the spec)
  const validationIssues = []
  if (floor && building && floor.buildingId && floor.buildingId !== building.buildingId) {
    validationIssues.push({
      level: 'Floor', featureId: floor.floorId, status: 'ERROR', severity: 'ERROR',
      rule: 'FLOOR_BELONGS_TO_BUILDING',
      message: `Floor ${floor.floorId} belongs to ${floor.buildingId}, not the associated building ${building.buildingId}.`,
    })
  }
  if (!building) {
    validationIssues.push({
      level: 'FloorPlan', featureId: 'building-association', status: 'INFO', severity: 'INFO',
      rule: 'BUILDING_ASSOCIATION_PRESENT',
      message: 'No buildingId supplied — units are stored in local coordinates and are not placed on the map.',
    })
  }
  if (building && !floor) {
    validationIssues.push({
      level: 'FloorPlan', featureId: 'floor-association', status: 'WARNING', severity: 'WARNING',
      rule: 'FLOOR_ASSOCIATION_PRESENT',
      message: 'buildingId supplied without floorId — floor elevation is unknown; unit volumes have no z-range.',
    })
  }

  /** Convert one Python unit into a stored AI floor-unit doc. */
  const projectUnit = (u, idx) => {
    const geoRing = tf ? toGeoRing(u.pixelPolygon, tf) : null
    const geometry = geoRing ? { type: 'Polygon', coordinates: [geoRing] } : null

    let volume = null
    let volumeValidation = null
    if (geometry && assoc.floorElevationM != null && assoc.floorHeightM != null) {
      volume = volumeFromFootprint(
        geometry,
        assoc.floorElevationM,
        assoc.floorElevationM + assoc.floorHeightM,
        { volumeId: u.volume?.volumeId || `FPV-${String(idx + 1).padStart(3, '0')}`, source: 'AI_DEMO' },
      )
      if (building) {
        const vr = validateUnitVolume(
          { geometry, baseHeight: assoc.floorElevationM, topHeight: assoc.floorElevationM + assoc.floorHeightM, unitId: u.unitId },
          building,
        )
        volumeValidation = vr
      }
    }

    return {
      geometry,                    // WGS84 GeoJSON polygon, or null (local only)
      localGeometry: { type: 'Polygon', coordinates: [u.pixelPolygon || []] },
      localVolume: u.volume || null,
      volume,                      // Phase-2 prototype volume (xmin..zmax) or null
      volumeValidation,
    }
  }

  return { assoc, tf, projectUnit, validationIssues }
}
