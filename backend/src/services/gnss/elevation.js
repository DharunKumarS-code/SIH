// Phase 5 elevation integration (spec section 15): compare a GNSS control
// point's own observed height against the existing DEM/DSM-derived model
// elevation for the building/parcel it is associated with. This NEVER
// declares the DEM/DSM wrong, and NEVER declares the GNSS reading correct —
// it only reports the residual and lets a human interpret it.

/**
 * @param {object} point          control point (needs .height, optional .verticalDatum)
 * @param {object|null} building  associated building doc (buildings collection), or null
 * @param {object|null} latestBuildingHeight  latest buildingHeights doc for that building, or null
 */
export function computeElevationResidual(point, building, latestBuildingHeight) {
  const observedElevation = Number.isFinite(point?.height) ? point.height : null
  if (observedElevation === null) {
    return {
      observedElevation: null,
      modelElevation: null,
      elevationResidualM: null,
      modelSource: null,
      verticalDatumStatus: 'UNKNOWN',
      dataAvailability: 'UNAVAILABLE',
      reason: 'Control point has no supplied height.',
    }
  }

  let modelElevation = null
  let modelSource = null
  if (latestBuildingHeight && Number.isFinite(latestBuildingHeight.groundElevationM)) {
    modelElevation = latestBuildingHeight.groundElevationM
    modelSource = 'DEM_DSM_DERIVED'
  } else if (building && Number.isFinite(building.baseElevationM)) {
    modelElevation = building.baseElevationM
    modelSource = 'DEMO_ESTIMATED'
  }

  if (modelElevation === null) {
    return {
      observedElevation,
      modelElevation: null,
      elevationResidualM: null,
      modelSource: null,
      verticalDatumStatus: 'UNKNOWN',
      dataAvailability: 'UNAVAILABLE',
      reason: 'No DEM/DSM-derived or demo ground elevation is available for the associated building.',
    }
  }

  // Vertical datum is only ever confirmed matched when BOTH sides declared
  // one and they agree — never assumed (spec section 4).
  const pointDatum = point?.verticalDatum || null
  const modelDatum = latestBuildingHeight?.verticalDatum || null
  let verticalDatumStatus = 'UNKNOWN'
  if (pointDatum && modelDatum) {
    verticalDatumStatus = String(pointDatum).trim().toUpperCase() === String(modelDatum).trim().toUpperCase() ? 'MATCHED' : 'MISMATCH'
  }

  return {
    observedElevation,
    modelElevation,
    elevationResidualM: Number((observedElevation - modelElevation).toFixed(3)),
    modelSource,
    verticalDatumStatus,
    dataAvailability: 'AVAILABLE',
  }
}
