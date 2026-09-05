// Phase 7 — intelligent 2D/3D topology validation engine (additive).
// Deterministic SYNTHETIC / TEST_FIXTURE data only, inserted directly into a
// dedicated `locality: 'topologytest'` and removed in test.after — never
// touches the real seeded Chennai demo dataset. Same test-harness conventions
// as tests/gnss.test.js (node:test + raw fetch against an ephemeral server).

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { rectRing, polygon, mToDegLon, mToDegLat } from '../src/data/geo.js'
import { candidatePairs, paddedBbox } from '../src/services/topology/spatialIndex.js'
import { summarize } from '../src/services/topology/result.js'
import { ruleMatches } from '../src/services/topology/severity.js'
import { validateParcelGaps } from '../src/services/topology/rules/parcelRules.js'

const LOCALITY = 'topologytest'
const LON = 80.30, LAT = 12.90 // far from the real Sholinganallur/Adyar/Anna Nagar demo data, no risk of collision

// Metre offsets from a centre point, correctly converted to degrees at LAT —
// writing a bare "+5" against a longitude/latitude value would silently mean
// 5 DEGREES (~550 km), not 5 metres.
const eastM = (lon, m) => lon + mToDegLon(m, LAT)
const northM = (lat, m) => lat + mToDegLat(m)

let app
let server
let base
let AREA_FINDINGS
let AREA_RUN_ID

test.before(async () => {
  await connectStore()
  app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`
      resolve()
    })
  })
  await seedFixtures()

  const officer = await surveyToken()
  const res = await post(`/api/topology/validate/area/${LOCALITY}`, {}, officer)
  AREA_FINDINGS = res.body.data.findings
  AREA_RUN_ID = res.body.data.validationRunId
})

test.after(async () => {
  await db.collection('parcels').deleteMany({ locality: LOCALITY })
  await db.collection('buildings').deleteMany({ locality: LOCALITY })
  await db.collection('floors').deleteMany({ locality: LOCALITY })
  await db.collection('propertyUnits').deleteMany({ locality: LOCALITY })
  await db.collection('topologyValidationResults').deleteMany({ scopeId: LOCALITY })
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await disconnectStore()
})

const get = async (p, token) => {
  const res = await fetch(base + p, token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
  return { status: res.status, body: await res.json() }
}
const post = async (p, data, token) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data || {}),
  })
  return { status: res.status, body: await res.json() }
}
const patch = async (p, data, token) => {
  const res = await fetch(base + p, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data || {}),
  })
  return { status: res.status, body: await res.json() }
}

const login = async (username, password) => (await post('/api/auth/login', { username, password })).body.data.token
const surveyToken = () => login('survey01', 'Officer@123')
const citizenToken = () => login('citizen01', 'Citizen@123')

// ----------------------------------------------------------------- fixtures

// A bowtie quadrilateral — the classic self-crossing-ring fixture, same
// vertex set as a square but visited in crossing order.
function bowtie(lon, lat, sizeM = 20) {
  const sq = rectRing(lon, lat, sizeM, sizeM)
  return [sq[0], sq[2], sq[1], sq[3], sq[0]]
}

let seq = 0
const nextLon = () => LON + (seq += 1) * 0.01 // ~1.1 km apart — each scenario gets its own patch of "sky", no accidental overlap/gap between unrelated scenarios

async function insertParcel(overrides) {
  const lon = overrides.lon ?? nextLon()
  const lat = overrides.lat ?? LAT
  const ring = overrides.ring || rectRing(lon, lat, overrides.widthM ?? 20, overrides.depthM ?? 20)
  const doc = {
    ulpin: overrides.ulpin,
    parcelId: overrides.parcelId || overrides.ulpin,
    locality: LOCALITY,
    geometry: overrides.geometry !== undefined ? overrides.geometry : polygon(ring),
    areaSqm: overrides.areaSqm,
    status: 'Verified',
    isDemo: true,
  }
  await db.collection('parcels').create(doc)
  return { ...doc, lon, lat, ring }
}

async function insertBuilding(overrides) {
  const doc = {
    buildingId: overrides.buildingId,
    buildingSegment: overrides.buildingSegment || overrides.buildingId.split('-').pop(),
    buildingNumber: overrides.buildingNumber ?? 1,
    ulpin: overrides.ulpin,
    locality: LOCALITY,
    geometry: overrides.geometry !== undefined ? overrides.geometry : polygon(overrides.ring),
    heightM: overrides.heightM ?? 10,
    baseElevationM: overrides.baseElevationM ?? 0,
    constructionStatus: 'Completed',
    isDemo: true,
  }
  await db.collection('buildings').create(doc)
  return doc
}

async function insertFloor(overrides) {
  const floorSegment = `F${String(overrides.floorNumber).padStart(2, '0')}`
  const doc = {
    floorId: overrides.floorId || `${overrides.buildingId}-${floorSegment}`,
    buildingId: overrides.buildingId,
    ulpin: overrides.ulpin,
    locality: LOCALITY,
    floorNumber: overrides.floorNumber,
    floorSegment,
    baseHeight: overrides.baseHeight,
    topHeight: overrides.topHeight,
    isDemo: true,
  }
  await db.collection('floors').create(doc)
  return doc
}

let unitSeq = 0

async function insertUnit(overrides) {
  const floorSegment = `F${String(overrides.floorNumber).padStart(2, '0')}`
  const doc = {
    propertyId: overrides.propertyId,
    unitId: overrides.unitId || overrides.propertyId.split('-').pop(),
    apartmentNumber: String(100 + (unitSeq += 1)), // distinct numeric suffix so Phase 2's deriveVolumeId doesn't collide across units
    buildingId: overrides.buildingId,
    floorId: overrides.floorId || `${overrides.buildingId}-${floorSegment}`,
    floorNumber: overrides.floorNumber,
    ulpin: overrides.ulpin,
    locality: LOCALITY,
    geometry: overrides.geometry !== undefined ? overrides.geometry : polygon(overrides.ring),
    baseHeight: overrides.baseHeight,
    topHeight: overrides.topHeight,
    builtUpAreaSqft: overrides.builtUpAreaSqft,
    status: 'Verified',
    isDemo: true,
  }
  await db.collection('propertyUnits').create(doc)
  return doc
}

async function seedFixtures() {
  // ---- A: valid complete hierarchy (positive) ----
  const aLon = nextLon()
  await insertParcel({ ulpin: 'TT-VALID', lon: aLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-VALID-B01', ulpin: 'TT-VALID', ring: rectRing(aLon, LAT, 30, 30), heightM: 20, baseElevationM: 0 })
  await insertFloor({ buildingId: 'TT-VALID-B01', ulpin: 'TT-VALID', floorNumber: 1, baseHeight: 0, topHeight: 3.2 })
  await insertFloor({ buildingId: 'TT-VALID-B01', ulpin: 'TT-VALID', floorNumber: 2, baseHeight: 3.2, topHeight: 6.4 })
  await insertUnit({ propertyId: 'TT-VALID-B01-F01-U101', buildingId: 'TT-VALID-B01', ulpin: 'TT-VALID', floorNumber: 1, ring: rectRing(eastM(aLon, -6), LAT, 10, 10), baseHeight: 0, topHeight: 3.2 })
  await insertUnit({ propertyId: 'TT-VALID-B01-F01-U102', buildingId: 'TT-VALID-B01', ulpin: 'TT-VALID', floorNumber: 1, ring: rectRing(eastM(aLon, 6), LAT, 10, 10), baseHeight: 0, topHeight: 3.2 })

  // ---- parcel rules ----
  await insertParcel({ ulpin: 'TT-SELFX', ring: bowtie(nextLon(), LAT) })
  await insertParcel({ ulpin: 'TT-SHORT', geometry: { type: 'Polygon', coordinates: [[[nextLon(), LAT], [nextLon() + 0.0001, LAT]]] } })
  await insertParcel({ ulpin: 'TT-EMPTY', geometry: null })
  await insertParcel({ ulpin: 'TT-AREA', lon: nextLon(), widthM: 20, depthM: 20, areaSqm: 4000 })

  const ovA = nextLon()
  await insertParcel({ ulpin: 'TT-OVERLAP-A', lon: ovA, widthM: 20, depthM: 20 })
  await insertParcel({ ulpin: 'TT-OVERLAP-B', lon: ovA + 0.00012, widthM: 20, depthM: 20 }) // ~13 m east — deliberate overlap

  const dupLon = nextLon()
  const dupRing = rectRing(dupLon, LAT, 20, 20)
  await insertParcel({ ulpin: 'TT-DUP-A', ring: dupRing })
  await insertParcel({ ulpin: 'TT-DUP-B', ring: dupRing })

  const gapLon = nextLon()
  await insertParcel({ ulpin: 'TT-GAP-A', lon: gapLon, widthM: 20, depthM: 20 })
  await insertParcel({ ulpin: 'TT-GAP-B', lon: gapLon + 0.0002, widthM: 20, depthM: 20 }) // ~1-2 m edge gap given 20 m width

  // ---- building rules ----
  const boutLon = nextLon()
  await insertParcel({ ulpin: 'TT-BOUT', lon: boutLon, widthM: 10, depthM: 10 })
  await insertBuilding({ buildingId: 'TT-BOUT-B01', ulpin: 'TT-BOUT', ring: rectRing(boutLon + 0.01, LAT, 10, 10) }) // ~1.1 km away — completely outside

  const bcrossLon = nextLon()
  await insertParcel({ ulpin: 'TT-BCROSS', lon: bcrossLon, widthM: 20, depthM: 20 })
  await insertBuilding({ buildingId: 'TT-BCROSS-B01', ulpin: 'TT-BCROSS', ring: rectRing(bcrossLon, LAT, 22, 22) }) // 1 m overshoot on every side

  const bovLon = nextLon()
  await insertParcel({ ulpin: 'TT-BOV', lon: bovLon, widthM: 60, depthM: 30 })
  await insertBuilding({ buildingId: 'TT-BOV-B01', ulpin: 'TT-BOV', ring: rectRing(eastM(bovLon, -5), LAT, 20, 20) })
  await insertBuilding({ buildingId: 'TT-BOV-B02', ulpin: 'TT-BOV', ring: rectRing(eastM(bovLon, 5), LAT, 20, 20) }) // overlaps B01 by design

  const selfBLon = nextLon()
  await insertParcel({ ulpin: 'TT-BSELFX', lon: selfBLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-BSELFX-B01', ulpin: 'TT-BSELFX', ring: bowtie(selfBLon, LAT, 20) })

  const dupBLon = nextLon()
  const dupBRing = rectRing(dupBLon, LAT, 20, 20)
  await insertParcel({ ulpin: 'TT-BDUP', lon: dupBLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-BDUP-B01', ulpin: 'TT-BDUP', ring: dupBRing })
  await insertBuilding({ buildingId: 'TT-BDUP-B02', ulpin: 'TT-BDUP', ring: dupBRing })

  const emptyBLon = nextLon()
  await insertParcel({ ulpin: 'TT-BEMPTY', lon: emptyBLon, widthM: 20, depthM: 20 })
  await insertBuilding({ buildingId: 'TT-BEMPTY-B01', ulpin: 'TT-BEMPTY', geometry: null })

  const tinyBLon = nextLon()
  await insertParcel({ ulpin: 'TT-BTINY', lon: tinyBLon, widthM: 20, depthM: 20 })
  await insertBuilding({ buildingId: 'TT-BTINY-B01', ulpin: 'TT-BTINY', ring: rectRing(tinyBLon, LAT, 0.5, 0.5) })

  // ---- floor rules (all hung off one building) ----
  const flLon = nextLon()
  await insertParcel({ ulpin: 'TT-FLOOR', lon: flLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-FLOOR-B01', ulpin: 'TT-FLOOR', ring: rectRing(flLon, LAT, 30, 30), heightM: 10, baseElevationM: 0 })
  await insertFloor({ buildingId: 'TT-FLOOR-B01', ulpin: 'TT-FLOOR', floorNumber: 1, baseHeight: 5, topHeight: 3 }) // INVALID_FLOOR_ELEVATION
  await insertFloor({ buildingId: 'TT-FLOOR-B01', ulpin: 'TT-FLOOR', floorNumber: 9, baseHeight: 8, topHeight: 15 }) // FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE (building envelope 0-10)
  await insertFloor({ buildingId: 'TT-FLOOR-B01', ulpin: 'TT-FLOOR', floorNumber: 9, floorId: 'TT-FLOOR-B01-F09-DUP', baseHeight: 8, topHeight: 15 }) // DUPLICATE_FLOOR

  const stackLon = nextLon()
  await insertParcel({ ulpin: 'TT-STACK', lon: stackLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-STACK-B01', ulpin: 'TT-STACK', ring: rectRing(stackLon, LAT, 30, 30), heightM: 50, baseElevationM: 0 })
  await insertFloor({ buildingId: 'TT-STACK-B01', ulpin: 'TT-STACK', floorNumber: 0, baseHeight: 0, topHeight: 3 })
  await insertFloor({ buildingId: 'TT-STACK-B01', ulpin: 'TT-STACK', floorNumber: 1, baseHeight: 5, topHeight: 8 })
  await insertFloor({ buildingId: 'TT-STACK-B01', ulpin: 'TT-STACK', floorNumber: 2, baseHeight: 6, topHeight: 9 }) // overlaps floor 1 (5-8) by 2 m
  await insertFloor({ buildingId: 'TT-STACK-B01', ulpin: 'TT-STACK', floorNumber: 3, baseHeight: 20, topHeight: 23 }) // big unexplained gap after floor 2 (top 9 -> base 20 = 11 m gap)

  // ---- unit rules ----
  const uLon = nextLon()
  await insertParcel({ ulpin: 'TT-UNIT', lon: uLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', ring: rectRing(uLon, LAT, 30, 30), heightM: 10, baseElevationM: 0 })
  await insertFloor({ buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, baseHeight: 0, topHeight: 3.2 })
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UOV1', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(uLon, LAT, 10, 10), baseHeight: 0, topHeight: 3.2 })
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UOV2', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(eastM(uLon, 5), LAT, 10, 10), baseHeight: 0, topHeight: 3.2 }) // overlaps UOV1
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UOUT', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(uLon + 0.01, LAT, 10, 10), baseHeight: 0, topHeight: 3.2 }) // ~1.1 km away -> outside + disconnected
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UZR', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(eastM(uLon, -12), LAT, 5, 5), baseHeight: 5, topHeight: 3 }) // INVALID_Z_RANGE
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UZOUT', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(eastM(uLon, -5), northM(LAT, 8), 5, 5), baseHeight: 0, topHeight: 8 }) // UNIT_OUTSIDE_FLOOR (floor band is 0-3.2)
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UAREA', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: rectRing(eastM(uLon, 5), northM(LAT, 8), 5, 5), baseHeight: 0, topHeight: 3.2, builtUpAreaSqft: 50000 }) // INVALID_UNIT_AREA
  const dupURing = rectRing(eastM(uLon, -5), northM(LAT, -8), 4, 4)
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UDUPA', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: dupURing, baseHeight: 0, topHeight: 3.2 })
  await insertUnit({ propertyId: 'TT-UNIT-B01-F01-UDUPB', buildingId: 'TT-UNIT-B01', ulpin: 'TT-UNIT', floorNumber: 1, ring: dupURing, baseHeight: 0, topHeight: 3.2 }) // DUPLICATE_UNIT + DUPLICATE_VOLUME

  // ---- volume-level: cross-floor intersection, degenerate/implausible volumes ----
  const vLon = nextLon()
  await insertParcel({ ulpin: 'TT-VOL', lon: vLon, widthM: 40, depthM: 40 })
  await insertBuilding({ buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', ring: rectRing(vLon, LAT, 30, 30), heightM: 10, baseElevationM: 0 })
  await insertFloor({ buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 1, baseHeight: 0, topHeight: 3.2 })
  await insertFloor({ buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 2, baseHeight: 3.0, topHeight: 6.2 })
  await insertUnit({ propertyId: 'TT-VOL-B01-F01-UX1', buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 1, ring: rectRing(vLon, LAT, 10, 10), baseHeight: 0, topHeight: 3.2 })
  await insertUnit({ propertyId: 'TT-VOL-B01-F02-UX2', buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 2, ring: rectRing(vLon, LAT, 10, 10), baseHeight: 3.0, topHeight: 6.2 }) // same footprint as UX1, overlapping z -> UNIT_VERTICAL_OVERLAP
  await insertUnit({ propertyId: 'TT-VOL-B01-F01-UHUGE', buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 1, ring: rectRing(eastM(vLon, 10), LAT, 5, 5), baseHeight: 0, topHeight: 600 }) // INVALID_HEIGHT
  await insertUnit({ propertyId: 'TT-VOL-B01-F01-USLIVER', buildingId: 'TT-VOL-B01', ulpin: 'TT-VOL', floorNumber: 1, ring: rectRing(eastM(vLon, -10), LAT, 0.01, 5), baseHeight: 0, topHeight: 3.2 }) // ZERO_OR_NEGATIVE_VOLUME (near-zero footprint area)
}

// --------------------------------------------------------------------- API

test('topology: config exposes tolerances, ML decision and the RULE_ENGINE disclaimer', async () => {
  const res = await get('/api/topology/config')
  assert.equal(res.status, 200)
  assert.match(res.body.data.disclaimer, /RULE_ENGINE|DETERMINISTIC_VALIDATION/)
  assert.match(res.body.data.mlDecision, /deterministic topology validation rules/i)
  assert.ok(Number.isFinite(res.body.data.tolerances.horizontalToleranceM))
})

test('topology: validate/area requires topology:validate; citizen is forbidden, survey officer succeeds', async () => {
  const citizen = await citizenToken()
  const forbidden = await post(`/api/topology/validate/area/${LOCALITY}`, {}, citizen)
  assert.equal(forbidden.status, 403)

  const officer = await surveyToken()
  const res = await post(`/api/topology/validate/area/${LOCALITY}`, {}, officer)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.scopeType, 'area')
  assert.ok(Array.isArray(res.body.data.findings))
  assert.ok(res.body.data.findings.length > 10, 'expected many synthetic defects to be flagged')
  assert.match(res.body.data.disclaimer, /RULE_ENGINE/)
})

test('topology: geometry is never modified by validation — parcel docs are byte-identical before and after', async () => {
  const before = await db.collection('parcels').findOne({ ulpin: 'TT-OVERLAP-A' })
  const officer = await surveyToken()
  await post(`/api/topology/validate/area/${LOCALITY}`, {}, officer)
  const after = await db.collection('parcels').findOne({ ulpin: 'TT-OVERLAP-A' })
  assert.deepEqual(before.geometry, after.geometry)
})

function has(entityId, ruleId, extra) {
  return AREA_FINDINGS.some((f) => f.entityId === entityId && ruleMatches(f.ruleId, ruleId) && (!extra || extra(f)))
}
function get1(entityId, ruleId) {
  return AREA_FINDINGS.find((f) => f.entityId === entityId && ruleMatches(f.ruleId, ruleId))
}
function byParent(parentEntityId, ruleId) {
  return AREA_FINDINGS.filter((f) => f.parentEntityId === parentEntityId && ruleMatches(f.ruleId, ruleId))
}

test('topology: parcel rules — self-intersection, invalid polygon, empty geometry, invalid area', () => {
  assert.ok(has('TT-SELFX', 'SELF_INTERSECTION'), 'bowtie parcel should self-intersect')
  assert.ok(has('TT-SHORT', 'INVALID_POLYGON'), 'a 2-point ring should be INVALID_POLYGON, not SELF_INTERSECTION')
  assert.ok(!has('TT-SHORT', 'SELF_INTERSECTION'))
  assert.ok(has('TT-EMPTY', 'EMPTY_GEOMETRY'), 'null geometry should be flagged EMPTY_GEOMETRY')
  const areaFinding = get1('TT-AREA', 'INVALID_AREA')
  assert.ok(areaFinding)
  assert.ok(areaFinding.computedValue > 0.25)
})

test('topology: parcel rules — overlap, duplicate geometry, gap classification', () => {
  const overlap = get1('TT-OVERLAP-A', 'OVERLAPPING_PARCELS')
  assert.ok(overlap, 'shifted-but-overlapping parcels should be flagged')
  assert.ok(overlap.computedValue > 0)
  assert.equal(overlap.status, 'ERROR')

  const dup = get1('TT-DUP-A', 'DUPLICATE_PARCEL_GEOMETRY')
  assert.ok(dup, 'identical-geometry parcels should be flagged as duplicates, not merely overlapping')
  assert.ok(dup.computedValue >= 0.9)

  const gap = get1('TT-GAP-A', 'GAPS')
  assert.ok(gap, 'a small suspicious gap between two parcels should be flagged')
  assert.ok(['WARNING', 'ERROR'].includes(gap.status))
  assert.ok(Number.isFinite(gap.tolerance))
})

test('topology: gap tolerance bands classify ERROR / WARNING / no-finding at different distances (pure rule)', () => {
  const a = { parcelId: 'A', locality: LOCALITY, status: 'Verified' }
  const b = { parcelId: 'B', locality: LOCALITY, status: 'Verified' }
  const errF = validateParcelGaps([[a, b]], () => 0.7) // between horizontalToleranceM (0.5) and gapErrorMaxM (1.0)
  assert.equal(errF[0].status, 'ERROR')
  const warnF = validateParcelGaps([[a, b]], () => 1.5) // between gapErrorMaxM (1.0) and gapWarnMaxM (2.0)
  assert.equal(warnF[0].status, 'WARNING')
  const noneF = validateParcelGaps([[a, b]], () => 50) // beyond gapCandidateRadiusM (10)
  assert.equal(noneF.length, 0)
})

test('topology: building rules — outside parcel vs crosses boundary are distinguished', () => {
  const outside = get1('TT-BOUT-B01', 'BUILDING_OUTSIDE_PARCEL')
  assert.ok(outside, 'a building far from its parcel should be BUILDING_OUTSIDE_PARCEL')
  assert.equal(outside.status, 'ERROR')

  const crosses = get1('TT-BCROSS-B01', 'BUILDING_CROSSES_PARCEL_BOUNDARY')
  assert.ok(crosses, 'a building overshooting its parcel by 1 m should be BUILDING_CROSSES_PARCEL_BOUNDARY, not OUTSIDE')
  assert.equal(crosses.status, 'WARNING')
  assert.ok(crosses.computedValue > 0 && crosses.computedValue < 5)
})

test('topology: building rules — footprint overlap, self-intersection, duplicate, empty, invalid area', () => {
  assert.ok(has('TT-BOV-B01', 'BUILDING_OVERLAP'))
  assert.ok(has('TT-BSELFX-B01', 'SELF_INTERSECTING_BUILDING'))
  assert.ok(has('TT-BDUP-B01', 'DUPLICATE_BUILDING'))
  assert.ok(has('TT-BEMPTY-B01', 'EMPTY_BUILDING_GEOMETRY'))
  assert.ok(has('TT-BTINY-B01', 'INVALID_BUILDING_AREA'))
})

test('topology: floor rules — invalid elevation, vertical range, stacking order, overlap, gap, duplicate', () => {
  assert.ok(byParent('TT-FLOOR-B01', 'INVALID_FLOOR_ELEVATION').length, 'baseHeight >= topHeight should be flagged')
  assert.ok(byParent('TT-FLOOR-B01', 'FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE').length, 'a floor exceeding the building envelope should be flagged')
  assert.ok(byParent('TT-FLOOR-B01', 'PARENT_CONTAINMENT').length, 'PARENT_CONTAINMENT alias should resolve to the same finding')
  assert.ok(byParent('TT-FLOOR-B01', 'DUPLICATE_FLOOR').length, 'two floors sharing a floor number should be flagged')

  assert.ok(byParent('TT-STACK-B01', 'INCORRECT_STACKING').length, 'floor 1 sitting below floor 0 should be flagged')
  assert.ok(byParent('TT-STACK-B01', 'FLOOR_OVERLAP').length, 'floor 2 overlapping floor 1 in z should be flagged')
  const bigGap = byParent('TT-STACK-B01', 'INCORRECT_STACKING').find((f) => f.computedValue > 5)
  assert.ok(bigGap, 'an 11 m unexplained gap between floors should be flagged as (severe) incorrect stacking')
  assert.equal(bigGap.status, 'ERROR')
})

test('topology: unit rules — overlap, outside building/floor, disconnected, area mismatch, duplicate', () => {
  assert.ok(has('UOV1', 'UNIT_OVERLAP'))
  assert.ok(has('UOUT', 'UNIT_OUTSIDE_BUILDING'))
  assert.ok(has('UOUT', 'UNIT_DISCONNECTED'), 'a unit ~1 km from its building is disconnected, not merely outside tolerance')
  assert.ok(has('UZOUT', 'UNIT_OUTSIDE_FLOOR'))
  assert.ok(has('UAREA', 'INVALID_UNIT_AREA'))
  assert.ok(has('UDUPA', 'DUPLICATE_UNIT'))
})

test('topology: 3D volume rules — invalid Z range, invalid height, zero volume, cross-floor intersection, duplicate volume', () => {
  assert.ok(byParent('TT-UNIT-B01', 'INVALID_Z_RANGE').length, 'a unit with baseHeight>=topHeight should fail the volume-level Z-range check')
  assert.ok(byParent('TT-VOL-B01', 'INVALID_HEIGHT').length, 'a 600 m tall unit is implausible')
  assert.ok(byParent('TT-VOL-B01', 'ZERO_OR_NEGATIVE_VOLUME').length, 'a sliver footprint should compute to ~zero volume')
  assert.ok(byParent('TT-VOL-B01', 'UNIT_VERTICAL_OVERLAP').length, 'two units with the same footprint on overlapping z-bands should intersect')
  assert.ok(byParent('TT-UNIT-B01', 'DUPLICATE_VOLUME').length, 'two units with identical bounds should also read as duplicate volumes')
})

test('topology: findings carry the full result schema (status, severity, entity, message, suggestedFix, tolerance, provenance)', () => {
  const f = AREA_FINDINGS.find((f2) => f2.ruleId === 'SELF_INTERSECTION')
  assert.ok(f)
  for (const key of ['validationId', 'ruleId', 'status', 'severity', 'entityType', 'entityId', 'message', 'suggestedFix', 'provenance', 'createdAt', 'focusRef']) {
    assert.ok(key in f, `finding is missing "${key}"`)
  }
  assert.ok(['VALID', 'WARNING', 'ERROR', 'REVIEW_REQUIRED'].includes(f.status))
  assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(f.severity))
  assert.equal(f.provenance, 'Verified')
  assert.equal(f.focusRef.kind, 'parcel')
})

test('topology: summary counts entities (not raw finding counts) and groups by entity + rule', () => {
  const entityCounts = { PARCEL: 3, BUILDING: 1, FLOOR: 0, UNIT: 0, VOLUME: 0 }
  const findings = [
    { entityType: 'PARCEL', entityId: 'p1', ruleId: 'SELF_INTERSECTION', status: 'ERROR' },
    { entityType: 'PARCEL', entityId: 'p1', ruleId: 'INVALID_AREA', status: 'WARNING' }, // same parcel, worse status wins
    { entityType: 'PARCEL', entityId: 'p2', ruleId: 'GAPS', status: 'WARNING' },
    { entityType: 'BUILDING', entityId: 'b1', ruleId: 'BUILDING_OVERLAP', status: 'ERROR' },
  ]
  const s = summarize(findings, entityCounts)
  assert.equal(s.byEntity.PARCEL.total, 3)
  assert.equal(s.byEntity.PARCEL.error, 1) // p1 (worst=ERROR)
  assert.equal(s.byEntity.PARCEL.warning, 1) // p2
  assert.equal(s.byEntity.PARCEL.valid, 1) // p3, never mentioned
  assert.equal(s.byEntity.BUILDING.total, 1)
  assert.equal(s.byEntity.BUILDING.error, 1)
  assert.equal(s.byEntity.BUILDING.valid, 0)
  assert.equal(s.byRule.SELF_INTERSECTION.total, 1)
  assert.equal(s.overallStatus, 'ERROR')
})

test('topology: findings filter by entity/status/severity/rule (including rule aliases)', async () => {
  const officer = await surveyToken()
  const res = await post(`/api/topology/validate/area/${LOCALITY}?entity=PARCEL`, {}, officer)
  assert.equal(res.status, 200)
  assert.ok(res.body.data.findings.every((f) => f.entityType === 'PARCEL'))

  const byAlias = await get(`/api/topology/results/${AREA_RUN_ID}?rule=PARENT_CONTAINMENT`, await surveyToken())
  assert.equal(byAlias.status, 200)
  assert.ok(byAlias.body.data.findings.length > 0, 'filtering by an alias name should still resolve to its canonical findings')
})

test('topology: results are persisted and listable; latest summary is exposed', async () => {
  const officer = await surveyToken()
  const listed = await get('/api/topology/results?scopeType=area', officer)
  assert.equal(listed.status, 200)
  assert.ok(listed.body.data.length > 0)
  assert.equal(listed.body.data[0].findings, undefined, 'the list endpoint should not inline every run’s full findings array')

  const summary = await get('/api/topology/summary?scopeType=area', officer)
  assert.equal(summary.status, 200)
  assert.ok(summary.body.data.summary)
})

test('topology: a finding can be marked reviewed without touching geometry', async () => {
  const finding = AREA_FINDINGS.find((f) => f.ruleId === 'SELF_INTERSECTION')
  assert.ok(finding)

  const before = await db.collection('parcels').findOne({ ulpin: 'TT-SELFX' })
  const officer = await surveyToken()
  const reviewed = await patch(`/api/topology/results/${AREA_RUN_ID}/findings/${finding.validationId}/review`, { action: 'ACKNOWLEDGED' }, officer)
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.body.data.findings.find((f) => f.validationId === finding.validationId).reviewAction, 'ACKNOWLEDGED')

  const after = await db.collection('parcels').findOne({ ulpin: 'TT-SELFX' })
  assert.deepEqual(before.geometry, after.geometry)
})

test('topology: review requires topology:review; an unknown finding 404s', async () => {
  const citizen = await citizenToken()
  const forbidden = await patch(`/api/topology/results/${AREA_RUN_ID}/findings/whatever/review`, { action: 'ACKNOWLEDGED' }, citizen)
  assert.equal(forbidden.status, 403)

  const officer = await surveyToken()
  const notFound = await patch(`/api/topology/results/${AREA_RUN_ID}/findings/NOPE/review`, { action: 'ACKNOWLEDGED' }, officer)
  assert.equal(notFound.status, 404)
})

test('topology: a nonexistent parcel/building/floor/unit scope 404s cleanly', async () => {
  const officer = await surveyToken()
  const cases = [
    '/api/topology/validate/parcel/NOPE',
    '/api/topology/validate/building/NOPE',
    '/api/topology/validate/floor/NOPE',
    '/api/topology/validate/unit/NOPE',
  ]
  for (const path of cases) {
    const res = await post(path, {}, officer)
    assert.equal(res.status, 404, path)
  }
})

test('topology: validating a single parcel scope is narrower than the whole area', async () => {
  const officer = await surveyToken()
  const res = await post('/api/topology/validate/parcel/TT-VALID', {}, officer)
  assert.equal(res.status, 200)
  assert.ok(res.body.data.findings.every((f) => !f.entityId.startsWith('TT-SELFX')))
})

test('topology: existing parcel/building APIs remain compatible after the topology module loads', async () => {
  const res = await get('/api/buildings')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.data))
})

// --------------------------------------------------------- spatial index

test('topology: spatial index only proposes candidate pairs whose bounding boxes actually overlap', () => {
  const near = { geometry: polygon(rectRing(LON, LAT, 10, 10)) }
  const far = { geometry: polygon(rectRing(LON + 1, LAT, 10, 10)) } // ~111 km away
  const touching = { geometry: polygon(rectRing(eastM(LON, 15), LAT, 10, 10)) }
  const pairs = candidatePairs([near, far, touching], (x) => x.geometry.coordinates[0], 10)
  assert.ok(pairs.some(([a, b]) => (a === near && b === touching) || (a === touching && b === near)))
  assert.ok(!pairs.some(([a, b]) => a === far || b === far))
})

test('topology: spatial index avoids O(n²) blow-up on a larger synthetic batch (performance)', () => {
  const items = []
  for (let i = 0; i < 500; i += 1) {
    items.push({ geometry: polygon(rectRing(LON + i * 0.01, LAT, 5, 5)) }) // spaced ~1.1 km apart — no two should ever be candidates
  }
  const started = Date.now()
  const pairs = candidatePairs(items, (x) => x.geometry.coordinates[0], 1)
  const elapsedMs = Date.now() - started
  assert.equal(pairs.length, 0, 'well-separated footprints should produce zero candidate pairs')
  assert.ok(elapsedMs < 2000, `spatial index took ${elapsedMs}ms for 500 items — expected well under a naive O(n²) full geometry pass`)
})

test('topology: paddedBbox grows a ring bbox by roughly the requested radius', () => {
  const ring = rectRing(LON, LAT, 10, 10)
  const tight = paddedBbox(ring, 0)
  const padded = paddedBbox(ring, 100)
  assert.ok(padded[0] < tight[0] && padded[2] > tight[2])
  assert.ok(padded[1] < tight[1] && padded[3] > tight[3])
})
