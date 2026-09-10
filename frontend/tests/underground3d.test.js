// Unit tests for the Underground Infrastructure 3D Explorer pure helpers.
// Run with:  npm --prefix frontend test   (node --test, no browser needed)

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UNDERGROUND_LAYERS, layerForType, toLocalMeters, geometryCentroid,
  drawDepth, drawThickness, drawWidth, isDemoRecord, provenanceView,
  dimText, diameterText, matchInfra, groupByLayer, depthVisibility,
} from '../src/lib/underground3d.js'

test('layerForType maps backend types onto the fixed explorer layers', () => {
  assert.equal(layerForType('METRO').key, 'METRO')
  assert.equal(layerForType('WATER_PIPELINE').key, 'WATER')
  assert.equal(layerForType('SEWER_PIPELINE').key, 'SEWER')
  assert.equal(layerForType('STORMWATER_DRAIN').key, 'STORM')
  assert.equal(layerForType('ELECTRICAL').key, 'ELEC')
  assert.equal(layerForType('TELECOM').key, 'TELECOM')
  assert.equal(layerForType('TUNNEL').key, 'TUNNEL')
  // GAS / duct / manhole / chamber / anything unknown -> "Other Authorized Utilities"
  assert.equal(layerForType('GAS').key, 'OTHER')
  assert.equal(layerForType('MANHOLE').key, 'OTHER')
  assert.equal(layerForType('SOMETHING_NEW').key, 'OTHER')
  assert.equal(UNDERGROUND_LAYERS.length, 8)
})

test('toLocalMeters projects lon/lat to local ENU metres about an origin', () => {
  const origin = { lon: 80.22705, lat: 12.90045 }
  const [e0, n0] = toLocalMeters([origin.lon, origin.lat], origin)
  assert.ok(Math.abs(e0) < 1e-6 && Math.abs(n0) < 1e-6)
  const [, north] = toLocalMeters([origin.lon, origin.lat + 0.001], origin)
  assert.ok(north > 100 && north < 120) // ~111.32 m per 0.001 deg lat
})

test('geometryCentroid handles Point / LineString / Polygon', () => {
  assert.deepEqual(geometryCentroid({ type: 'Point', coordinates: [10, 20] }), { lon: 10, lat: 20 })
  const c = geometryCentroid({ type: 'LineString', coordinates: [[0, 0], [2, 4]] })
  assert.deepEqual(c, { lon: 1, lat: 2 })
})

test('drawDepth NEVER invents a value', () => {
  assert.deepEqual(drawDepth({ depthBelowSurfaceM: 4 }), { value: 4, known: true, basis: 'DEPTH_BELOW_SURFACE' })
  // surface - top elevation is an allowed derivation
  assert.equal(drawDepth({ surfaceElevationM: 8, topElevationM: 5.5 }).value, 2.5)
  // nothing usable -> unknown, value stays null
  assert.deepEqual(drawDepth({}), { value: null, known: false, basis: 'UNKNOWN' })
  assert.deepEqual(drawDepth({ depthBelowSurfaceM: null, diameterM: 0.3 }).known, false)
})

test('drawThickness / drawWidth fall back without fabricating a "real" dimension', () => {
  assert.equal(drawThickness({ diameterM: 0.6 }), 0.6)
  assert.equal(drawThickness({ heightM: 3 }), 3)
  assert.equal(drawThickness({}), 0.4) // visual default only
  assert.equal(drawWidth({ widthM: 0.9 }), 0.9)
  assert.equal(drawWidth({ diameterM: 0.3 }), 0.3)
})

test('provenance: a DEMO record is never treated as official', () => {
  const demo = { source: 'DEMO', verificationStatus: 'DEMO', isOfficial: false }
  assert.equal(isDemoRecord(demo), true)
  const pv = provenanceView(demo)
  assert.equal(pv.provenance, 'DEMO')
  assert.equal(pv.isOfficial, false)
  assert.equal(pv.demo, true)

  // even isOfficial:true is downgraded if verificationStatus says otherwise
  assert.equal(isDemoRecord({ isOfficial: true, verificationStatus: 'UNVERIFIED' }), true)
  // a genuinely official record
  const off = { source: 'OFFICIAL', verificationStatus: 'OFFICIAL', isOfficial: true }
  assert.equal(isDemoRecord(off), false)
  assert.equal(provenanceView(off).isOfficial, true)
})

test('dimText / diameterText say "Unavailable" rather than guess', () => {
  assert.equal(dimText(0.9), '0.9 m')
  assert.equal(dimText(null), 'Unavailable')
  assert.equal(dimText(undefined), 'Unavailable')
  assert.equal(diameterText({ diameterM: 0.6 }), '600 mm')
  assert.equal(diameterText({}), 'Unavailable')
})

test('matchInfra searches id / type / ULPIN / locality (substring, case-insensitive)', () => {
  const rec = { infrastructureId: 'INF-DEMO-SHLN-METRO-0001', type: 'METRO', parentParcelULPIN: 'TN-CHN-123456789', locality: 'sholinganallur' }
  assert.equal(matchInfra(rec, ''), true)
  assert.equal(matchInfra(rec, 'metro'), true)
  assert.equal(matchInfra(rec, 'TN-CHN-123456789'), true)
  assert.equal(matchInfra(rec, 'sholin'), true)
  assert.equal(matchInfra(rec, 'adyar'), false)
})

test('groupByLayer keeps every layer even when it has no data', () => {
  const rows = [{ type: 'METRO', infrastructureId: 'a' }, { type: 'WATER_PIPELINE', infrastructureId: 'b' }]
  const g = groupByLayer(rows)
  assert.equal(g.length, 8)
  assert.equal(g.find((x) => x.layer.key === 'METRO').items.length, 1)
  assert.equal(g.find((x) => x.layer.key === 'TELECOM').items.length, 0)
})

test('depthVisibility: unknown depth only shows in ALL / SURFACE_UNDERGROUND', () => {
  assert.equal(depthVisibility({ depth: null, sliceDepth: 5, mode: 'ALL' }).visible, true)
  assert.equal(depthVisibility({ depth: null, sliceDepth: 5, mode: 'SURFACE_UNDERGROUND' }).visible, true)
  assert.equal(depthVisibility({ depth: null, sliceDepth: 5, mode: 'SLICE' }).visible, false)
  assert.equal(depthVisibility({ depth: null, sliceDepth: 5, mode: 'DEEP' }).visible, false)
})

test('depthVisibility: DEEP mode shows only infra at/below the slider', () => {
  assert.equal(depthVisibility({ depth: 12, sliceDepth: 8, mode: 'DEEP' }).visible, true)
  assert.equal(depthVisibility({ depth: 2, sliceDepth: 8, mode: 'DEEP' }).visible, false)
})

test('depthVisibility: SLICE highlights the band around the slider and hides deeper infra', () => {
  const near = depthVisibility({ depth: 5, sliceDepth: 5, mode: 'SLICE' })
  assert.equal(near.visible, true)
  assert.equal(near.highlight, true)
  const above = depthVisibility({ depth: 1, sliceDepth: 5, mode: 'SLICE' })
  assert.equal(above.visible, true)
  assert.equal(above.dim, true)
  const below = depthVisibility({ depth: 12, sliceDepth: 5, mode: 'SLICE' })
  assert.equal(below.visible, false)
})
