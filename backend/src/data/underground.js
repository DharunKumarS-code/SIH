// ---------------------------------------------------------------------------
// Phase 8 — deterministic DEMO underground infrastructure fixtures.
//
// EVERYTHING here is synthetic DEMO DATA. It uses realistic Chennai coordinates
// and plausible values but represents NO real Chennai government utility
// infrastructure. Every record carries:
//     source: 'DEMO'  ·  verificationStatus: 'DEMO'  ·  isOfficial: false
//     legalOwnership: 'NOT_PROVIDED'  ·  verticalDatum: 'UNKNOWN'
// so the UI can (and must) visibly distinguish it from official / authorized
// infrastructure. Depths are illustrative "DEMO DEPTH" values with an explicit
// GROUND_SURFACE reference and an UNKNOWN vertical datum — never presented as
// surveyed absolute elevations.
//
// One small deterministic network is generated per locality (Sholinganallur /
// Adyar / Anna Nagar) so the SAME Chennai-wide Cesium viewer can demand-load
// each locality's underground infrastructure exactly like every other layer.
// ---------------------------------------------------------------------------

import { mToDegLon, mToDegLat } from './geo.js'
import { UNDERGROUND_DISCLAIMER } from '../services/underground/config.js'
import { associate } from '../services/underground/associate.js'
import { verticalBand } from '../services/underground/geometry.js'

const GROUND_ELEV_M = 8 // matches seed.js GROUND_ELEV — approx local ground surface

const off = (lon, lat, eastM, northM) => [lon + mToDegLon(eastM, lat), lat + mToDegLat(northM)]
const line = (base, pts) => ({ type: 'LineString', coordinates: pts.map(([e, n]) => off(base.lon, base.lat, e, n)) })
const pointG = (base, e, n) => ({ type: 'Point', coordinates: off(base.lon, base.lat, e, n) })
const rectG = (base, cE, cN, wM, dM) => {
  const [lon, lat] = off(base.lon, base.lat, cE, cN)
  const dLon = mToDegLon(wM / 2, lat)
  const dLat = mToDegLat(dM / 2)
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - dLon, lat - dLat], [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat], [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ]],
  }
}

// Per-locality catalogue. Depth is depthBelowSurface (m) to the crown; the
// vertical band is derived deterministically from surfaceElevation - depth.
function catalogue(loc) {
  const B = loc.base
  const TAG = loc.idTag
  const iid = (slug, n) => `INF-DEMO-${TAG}-${slug}-${String(n).padStart(4, '0')}`

  // Layout is deliberately conflict-free: utility mains run in their own
  // parallel E-W corridors at distinct depths; ONE short N-S water main is
  // routed to cross the sewer purely to demonstrate that a 2D crossing with
  // different Z is NOT a 3D collision (spec section 19); and the metro tunnel
  // passes ~14 m under everything (2D intersections only).
  return [
    {
      infrastructureId: iid('WATER', 1),
      type: 'WATER_PIPELINE',
      subtype: 'Distribution main',
      ownerAuthority: 'Chennai Metro Water (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[0, -60], [0, -20], [0, 20], [0, 60]]), // short N-S spur — crosses the sewer at (0,0) in plan only
      diameterM: 0.3,
      depthBelowSurfaceM: 1.5, // band ~[6.2, 6.5]
    },
    {
      infrastructureId: iid('SEWER', 1),
      type: 'SEWER_PIPELINE',
      subtype: 'Gravity sewer',
      ownerAuthority: 'Chennai Metro Water (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-220, 0], [-60, 0], [60, 0], [220, 0]]), // E-W
      diameterM: 0.45,
      depthBelowSurfaceM: 4.0, // band ~[3.55, 4.0] — 2.2 m clear below the water main
    },
    {
      infrastructureId: iid('STORM', 1),
      type: 'STORMWATER_DRAIN',
      subtype: 'Box drain',
      ownerAuthority: 'Greater Chennai Corporation — Storm Water Drain (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-200, 90], [0, 92], [200, 90]]), // own corridor, north
      widthM: 0.9,
      heightM: 0.6,
      depthBelowSurfaceM: 1.0,
    },
    {
      infrastructureId: iid('ELEC', 1),
      type: 'ELECTRICAL',
      subtype: 'HT duct bank',
      ownerAuthority: 'TANGEDCO (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-200, -90], [0, -90], [200, -90]]), // own corridor, south
      diameterM: 0.2,
      depthBelowSurfaceM: 0.9,
    },
    {
      infrastructureId: iid('TEL', 1),
      type: 'TELECOM',
      subtype: 'Fibre duct',
      ownerAuthority: 'Fibre ISP (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-200, -94], [0, -94], [200, -94]]), // runs parallel to the electrical duct bank (~4 m offset)
      diameterM: 0.1,
      depthBelowSurfaceM: 0.7,
    },
    {
      infrastructureId: iid('GAS', 1),
      type: 'GAS',
      subtype: 'MP gas main',
      ownerAuthority: 'City Gas Distribution (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-180, 150], [0, 150], [180, 150]]), // own corridor, far north
      diameterM: 0.15,
      depthBelowSurfaceM: 1.4,
    },
    {
      infrastructureId: iid('METRO', 1),
      type: 'METRO',
      subtype: 'Bored running tunnel',
      ownerAuthority: 'Chennai Metro Rail Ltd (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-190, -190], [-70, -70], [70, 70], [190, 190]]), // diagonal — crosses several utilities in plan, but ~14 m below them
      widthM: 6.4,
      heightM: 6.0,
      depthBelowSurfaceM: 14.0, // band ~[-12, -6]
    },
    {
      infrastructureId: iid('DUCT', 1),
      type: 'UTILITY_DUCT',
      subtype: 'Common services duct',
      ownerAuthority: 'Greater Chennai Corporation (DEMO)',
      status: 'OPERATIONAL',
      geometry: line(B, [[-180, -150], [0, -150], [180, -150]]), // own corridor, far south
      widthM: 1.2,
      heightM: 1.0,
      depthBelowSurfaceM: 1.1,
    },
    {
      infrastructureId: iid('MH', 1),
      type: 'MANHOLE',
      subtype: 'Sewer access chamber',
      ownerAuthority: 'Chennai Metro Water (DEMO)',
      status: 'OPERATIONAL',
      geometry: pointG(B, -40, 40),
      widthM: 1.2,
      heightM: 1.2,
      depthBelowSurfaceM: 4.2,
    },
    {
      infrastructureId: iid('CHMBR', 1),
      type: 'CHAMBER',
      subtype: 'Switchgear vault',
      ownerAuthority: 'TANGEDCO — Switchgear Vault (DEMO)',
      status: 'OPERATIONAL',
      geometry: rectG(B, -120, -35, 4, 3),
      widthM: 4.0,
      heightM: 3.0,
      depthBelowSurfaceM: 1.5,
    },
  ]
}

/**
 * Build every DEMO underground infrastructure document for one locality.
 * @param {object} loc     locality registry entry (localities.js)
 * @param {object[]} parcels    the locality's parcel docs (for spatial relation)
 * @param {object[]} buildings  the locality's building docs (for spatial relation)
 */
export function buildLocalityUndergroundInfrastructure(loc, parcels = [], buildings = []) {
  const now = new Date().toISOString()
  return catalogue(loc).map((c) => {
    const surfaceElevationM = GROUND_ELEV_M
    const topElevationM = Number((surfaceElevationM - c.depthBelowSurfaceM).toFixed(3))
    const thickness = Number.isFinite(c.diameterM) ? c.diameterM : Number.isFinite(c.heightM) ? c.heightM : 0
    const bottomElevationM = Number((topElevationM - thickness).toFixed(3))
    const base = {
      ...c,
      surfaceElevationM,
      topElevationM,
      bottomElevationM,
      depthReference: 'GROUND_SURFACE',
      // DEMO depth: explicit relative reference, vertical datum NOT claimed.
      verticalDatum: 'UNKNOWN',
      verticalReference: 'Local ground surface (approx.)',
      verticalStatus: 'DEMO',
      epoch: null,
      // ---- CRS ----
      inputCRS: 'EPSG:4326',
      outputCRS: 'EPSG:4326',
      crsStatus: 'MATCHED',
      horizontalDatum: 'WGS84',
      // ---- provenance — NEVER auto-promoted ----
      source: 'DEMO',
      verificationStatus: 'DEMO',
      isOfficial: false,
      provenanceNote: 'Deterministic synthetic demonstration data — not authoritative Chennai utility infrastructure.',
      timestamp: '2026-01-01T00:00:00.000Z',
      // ---- survey linkage: none for demo ----
      controlPointId: null,
      surveySessionId: null,
      referenceStation: null,
      surveyMethod: null,
      reportedAccuracyM: null,
      // ---- legal ownership: never inferred from geometry ----
      legalOwnership: 'NOT_PROVIDED',
      confidence: null,
      reviewRequired: false,
      metadata: {},
      locality: loc.id,
      isDemo: true,
      createdBy: null,
      createdAt: now,
      disclaimer: UNDERGROUND_DISCLAIMER,
    }
    // Spatial association — geometry facts only, never legal ownership.
    const assoc = associate(base, parcels, buildings)
    return {
      ...base,
      spatialRelation: assoc.spatialRelation,
      parentParcel: assoc.parentParcel,
      parentParcelULPIN: assoc.parentParcelULPIN,
      parentBuilding: assoc.parentBuilding,
      parcelRelations: assoc.parcelRelations,
      buildingRelations: assoc.buildingRelations,
    }
  })
}

/** Convenience: verticalBand of a stored demo record (used by tests/docs). */
export { verticalBand }
