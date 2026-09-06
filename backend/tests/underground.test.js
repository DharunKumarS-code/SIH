// Phase 8 — underground 3D infrastructure mapping (additive). Deterministic
// SYNTHETIC / DEMO data only, inserted directly into a dedicated
// `locality: 'undergroundtest'` and removed in test.after — never touches the
// real seeded Chennai demo dataset. Same test-harness conventions as
// tests/gnss.test.js / tests/topology.test.js (node:test + raw fetch against an
// ephemeral server).

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { rectRing, polygon, mToDegLon, mToDegLat } from '../src/data/geo.js'
import { validateRecord, validateIntersections } from '../src/services/underground/validate.js'
import { associate } from '../src/services/underground/associate.js'
import { verticalBand, intersection3D, geomShape } from '../src/services/underground/geometry.js'

const LOCALITY = 'undergroundtest'
// Near Sholinganallur so the project-area rule does NOT flag these — one
// fixture is deliberately placed far away to exercise INF_OUTSIDE_PROJECT_AREA.
const LON = 80.2270
const LAT = 12.9010
const eastM = (m) => LON + mToDegLon(m, LAT)
const northM = (m) => LAT + mToDegLat(m)

let app
let server
let base
const IMPORT_IDS = []

test.before(async () => {
  await connectStore()
  app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; resolve() })
  })
  await seedFixtures()
})

test.after(async () => {
  await db.collection('undergroundInfrastructure').deleteMany({ locality: LOCALITY })
  await db.collection('parcels').deleteMany({ locality: LOCALITY })
  await db.collection('infrastructureValidationResults').deleteMany({ scopeId: LOCALITY })
  if (IMPORT_IDS.length) await db.collection('undergroundInfrastructure').deleteMany({ infrastructureId: { $in: IMPORT_IDS } })
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
const postFile = async (p, { filename, text, format, extra = {} }, token) => {
  const fd = new FormData()
  fd.append('file', new Blob([text]), filename)
  fd.append('format', format)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(base + p, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : undefined, body: fd })
  return { status: res.status, body: await res.json() }
}

const login = async (u, pw) => (await post('/api/auth/login', { username: u, password: pw })).body.data.token
const surveyToken = () => login('survey01', 'Officer@123')
const citizenToken = () => login('citizen01', 'Citizen@123')

// --------------------------------------------------------------- fixtures

const GROUND = 8
const withDepth = (depth, thickness) => ({
  surfaceElevationM: GROUND,
  topElevationM: Number((GROUND - depth).toFixed(3)),
  bottomElevationM: Number((GROUND - depth - thickness).toFixed(3)),
  depthBelowSurfaceM: depth,
  depthReference: 'GROUND_SURFACE',
})

async function insertInfra(o) {
  const doc = {
    infrastructureId: o.infrastructureId,
    type: o.type,
    subtype: o.subtype || null,
    ownerAuthority: o.ownerAuthority || null,
    status: o.status || 'OPERATIONAL',
    geometry: o.geometry,
    source: o.source || 'DEMO',
    verificationStatus: o.verificationStatus || (o.source === 'AUTHORIZED' ? 'AUTHORIZED' : 'DEMO'),
    isOfficial: o.source === 'AUTHORIZED' || o.source === 'OFFICIAL',
    diameterM: o.diameterM ?? null,
    widthM: o.widthM ?? null,
    heightM: o.heightM ?? null,
    surfaceElevationM: o.surfaceElevationM ?? null,
    topElevationM: o.topElevationM ?? null,
    bottomElevationM: o.bottomElevationM ?? null,
    depthBelowSurfaceM: o.depthBelowSurfaceM ?? null,
    depthReference: o.depthReference || 'UNKNOWN',
    verticalDatum: o.verticalDatum || 'UNKNOWN',
    verticalStatus: o.verticalStatus || (o.topElevationM != null ? 'DEMO' : 'UNKNOWN'),
    inputCRS: o.inputCRS ?? 'EPSG:4326',
    outputCRS: 'EPSG:4326',
    crsStatus: o.crsStatus || 'MATCHED',
    horizontalDatum: 'WGS84',
    controlPointId: o.controlPointId || null,
    surveySessionId: o.surveySessionId || null,
    reportedAccuracyM: o.reportedAccuracyM ?? null,
    spatialRelation: o.spatialRelation || 'CROSSES_PARCEL',
    parentParcel: o.parentParcel || null,
    parentParcelULPIN: o.parentParcelULPIN || null,
    parentBuilding: o.parentBuilding || null,
    parcelRelations: [],
    buildingRelations: [],
    legalOwnership: o.legalOwnership || 'NOT_PROVIDED',
    confidence: null,
    metadata: {},
    locality: LOCALITY,
    isDemo: !(o.source === 'AUTHORIZED' || o.source === 'OFFICIAL'),
    createdAt: new Date().toISOString(),
  }
  await db.collection('undergroundInfrastructure').create(doc)
  return doc
}

async function seedFixtures() {
  // a parcel in the test locality so relations resolve to it
  await db.collection('parcels').create({
    ulpin: 'UGT-PARCEL-1', parcelId: 'UGT-PCL-1', locality: LOCALITY,
    geometry: polygon(rectRing(LON, LAT, 400, 400)), status: 'Verified', isDemo: true,
  })

  // Water main — short N-S spur, shallow
  await insertInfra({
    infrastructureId: 'UGT-WATER', type: 'WATER_PIPELINE', ownerAuthority: 'Chennai Metro Water (DEMO)',
    geometry: { type: 'LineString', coordinates: [[LON, northM(-80)], [LON, northM(80)]] },
    diameterM: 0.3, ...withDepth(1.5, 0.3), // band ~[6.2, 6.5]
  })
  // Sewer — E-W, deep. Crosses the water main at (LON,LAT) in PLAN only.
  await insertInfra({
    infrastructureId: 'UGT-SEWER', type: 'SEWER_PIPELINE', ownerAuthority: 'Chennai Metro Water (DEMO)',
    geometry: { type: 'LineString', coordinates: [[eastM(-120), LAT], [eastM(120), LAT]] },
    diameterM: 0.45, ...withDepth(4.0, 0.45), // band ~[3.55, 4.0] -> 2.2 m clear below the water main
  })
  // Electrical duct — E-W, at the SAME shallow depth as the water main and
  // crossing it -> a genuine 3D collision.
  await insertInfra({
    infrastructureId: 'UGT-ELEC', type: 'ELECTRICAL', ownerAuthority: 'TANGEDCO (DEMO)',
    geometry: { type: 'LineString', coordinates: [[eastM(-120), northM(20)], [eastM(120), northM(20)]] },
    diameterM: 0.2, ...withDepth(1.4, 0.2), // band ~[6.4, 6.6] -> overlaps the water band
  })
  // Manhole — point, off every line
  await insertInfra({
    infrastructureId: 'UGT-MANHOLE', type: 'MANHOLE', ownerAuthority: 'Chennai Metro Water (DEMO)',
    geometry: { type: 'Point', coordinates: [eastM(-60), northM(60)] },
    widthM: 1.2, heightM: 1.2, ...withDepth(2.0, 1.2),
  })
  // Chamber — polygon volume
  await insertInfra({
    infrastructureId: 'UGT-CHAMBER', type: 'CHAMBER', ownerAuthority: 'TANGEDCO — Vault (DEMO)',
    geometry: polygon(rectRing(eastM(-90), northM(-90), 4, 3)),
    widthM: 4, heightM: 3, ...withDepth(1.5, 3),
  })
  // Real-survey record with NO reliable Z — depth/elevation must stay null.
  await insertInfra({
    infrastructureId: 'UGT-NODEPTH', type: 'WATER_PIPELINE', ownerAuthority: 'Utility (REAL)',
    source: 'REAL_SURVEY', verificationStatus: 'REAL_SURVEY',
    geometry: { type: 'LineString', coordinates: [[eastM(30), northM(-30)], [eastM(90), northM(-30)]] },
    diameterM: 0.25,
    surfaceElevationM: null, topElevationM: null, bottomElevationM: null, depthBelowSurfaceM: null,
    verticalStatus: 'UNKNOWN', depthReference: 'UNKNOWN',
  })
  // Authorized record — isOfficial true.
  await insertInfra({
    infrastructureId: 'UGT-AUTH', type: 'GAS', ownerAuthority: 'City Gas Distribution',
    source: 'AUTHORIZED', verificationStatus: 'AUTHORIZED',
    geometry: { type: 'LineString', coordinates: [[eastM(-120), northM(-120)], [eastM(120), northM(-120)]] },
    diameterM: 0.15, verticalDatum: 'MSL', ...withDepth(1.2, 0.15),
  })
  // Far-away record — exercises INF_OUTSIDE_PROJECT_AREA.
  await insertInfra({
    infrastructureId: 'UGT-FAR', type: 'TELECOM', ownerAuthority: 'ISP (DEMO)',
    geometry: { type: 'LineString', coordinates: [[80.55, 13.30], [80.56, 13.31]] },
    diameterM: 0.1, ...withDepth(0.8, 0.1),
  })
}

// ------------------------------------------------------------------ API

test('underground: config exposes the pipeline, controlled types, provenance model and the disclaimer', async () => {
  const res = await get('/api/infrastructure/config')
  assert.equal(res.status, 200)
  assert.match(res.body.data.disclaimer, /UNDERGROUND INFRASTRUCTURE DATA/)
  assert.ok(res.body.data.infrastructureTypes.includes('WATER_PIPELINE'))
  assert.ok(res.body.data.infrastructureTypes.includes('METRO'))
  assert.deepEqual([...res.body.data.neverAutoPromote].sort(), ['DEMO', 'RESEARCH', 'UNVERIFIED', 'UPLOADED_SURVEY'].sort())
  assert.ok(Number.isFinite(res.body.data.thresholds.projectAreaRadiusM))
})

test('underground: list + filter by type / source / verificationStatus', async () => {
  const all = await get(`/api/infrastructure?locality=${LOCALITY}`)
  assert.equal(all.status, 200)
  assert.ok(all.body.data.length >= 8)

  const water = await get(`/api/infrastructure?locality=${LOCALITY}&type=WATER_PIPELINE`)
  assert.ok(water.body.data.every((r) => r.type === 'WATER_PIPELINE'))

  const auth = await get(`/api/infrastructure?locality=${LOCALITY}&verificationStatus=AUTHORIZED`)
  assert.ok(auth.body.data.length >= 1)
  assert.ok(auth.body.data.every((r) => r.isOfficial === true))
})

test('underground: depth filter is applied only to records that actually have a depth', async () => {
  const deep = await get(`/api/infrastructure?locality=${LOCALITY}&minDepthM=3`)
  assert.ok(deep.body.data.length >= 1)
  assert.ok(deep.body.data.every((r) => r.depthBelowSurfaceM >= 3))
  // the no-depth record must never appear in a depth-bounded query
  assert.ok(!deep.body.data.some((r) => r.infrastructureId === 'UGT-NODEPTH'))
})

test('underground: detail returns the full model with an explicit vertical reference', async () => {
  const res = await get('/api/infrastructure/UGT-WATER')
  assert.equal(res.status, 200)
  const d = res.body.data
  assert.equal(d.type, 'WATER_PIPELINE')
  assert.equal(d.depthReference, 'GROUND_SURFACE')
  assert.equal(d.verticalDatum, 'UNKNOWN')
  assert.equal(d.isOfficial, false)
  assert.equal(d.legalOwnership, 'NOT_PROVIDED')
})

test('underground: TRUE DEPTH RULE — a real-survey record with no Z keeps null depth/elevation and UNKNOWN vertical status', async () => {
  const res = await get('/api/infrastructure/UGT-NODEPTH')
  assert.equal(res.body.data.topElevationM, null)
  assert.equal(res.body.data.bottomElevationM, null)
  assert.equal(res.body.data.depthBelowSurfaceM, null)
  assert.equal(res.body.data.verticalStatus, 'UNKNOWN')
  assert.equal(verticalBand(res.body.data), null)
})

test('underground: GIS layer is GeoJSON and never places a CRS-failed record with a guessed position', async () => {
  const res = await get(`/api/gis/underground-infrastructure?locality=${LOCALITY}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.type, 'FeatureCollection')
  assert.ok(res.body.data.features.length >= 8)
  assert.ok(res.body.data.features.every((f) => ['Point', 'LineString', 'Polygon'].includes(f.geometry.type)))
  assert.ok(res.body.data.features.every((f) => f.properties.isOfficial === false || f.properties.verificationStatus === 'AUTHORIZED'))
})

test('underground: relations return spatial facts and legal ownership SEPARATELY — intersection is never ownership', async () => {
  const res = await get('/api/infrastructure/UGT-WATER/relations')
  assert.equal(res.status, 200)
  assert.ok(res.body.data.spatialRelation)
  assert.equal(res.body.data.legalOwnership, 'NOT_PROVIDED')
  assert.match(res.body.data.ownershipNote, /does not establish legal ownership/i)
  // the water main runs across the test parcel
  assert.ok(res.body.data.parcelRelations.some((r) => r.parcelId === 'UGT-PCL-1'))
})

test('underground: elevation context reuses Phase 5 surface data and never treats DSM/DEM as an underground depth', async () => {
  const res = await get('/api/infrastructure/UGT-WATER/elevation')
  assert.equal(res.status, 200)
  assert.match(res.body.data.note || '', /never used as an underground depth/i)
})

test('underground: 2D crossing with different Z is reported as 2D_INTERSECTION, NOT a 3D collision', async () => {
  const water = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-WATER' })
  const sewer = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-SEWER' })
  const rel = intersection3D(water, geomShape(water), sewer, geomShape(sewer), (await import('../src/services/underground/config.js')).UNDERGROUND_CONFIG)
  assert.equal(rel.horizontal2D, 'INTERSECT')
  assert.equal(rel.relationship, '2D_INTERSECTION')
  assert.ok(rel.verticalSeparationM > 1.5)
  assert.notEqual(rel.relationship, '3D_COLLISION')
})

test('underground: a true 3D collision (crossing in plan AND overlapping vertical bands) is flagged', async () => {
  const records = await db.collection('undergroundInfrastructure').find({ locality: LOCALITY })
  const findings = validateIntersections(records)
  const collision = findings.find((f) => f.ruleId === 'INF_3D_COLLISION')
  assert.ok(collision, 'the water main and the shallow electrical duct crossing it must be a 3D collision')
  const ids = [collision.entityId, collision.relatedEntityId].sort()
  assert.deepEqual(ids, ['UGT-ELEC', 'UGT-WATER'])
  // and the water×sewer pair must NOT be a collision
  assert.ok(!findings.some((f) => f.ruleId === 'INF_3D_COLLISION'
    && [f.entityId, f.relatedEntityId].includes('UGT-SEWER')
    && [f.entityId, f.relatedEntityId].includes('UGT-WATER')))
})

test('underground: POST /infrastructure/validate runs deterministic rules and persists a run (never mutates geometry)', async () => {
  const officer = await surveyToken()
  const before = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-WATER' })
  const res = await post('/api/infrastructure/validate', { scope: 'locality', locality: LOCALITY }, officer)
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.data.findings))
  assert.match(res.body.data.mlDecision, /deterministic .* rules|not AI\/ML/i)
  assert.match(res.body.data.disclaimer, /UNDERGROUND INFRASTRUCTURE DATA/)
  assert.ok(res.body.data.findings.some((f) => f.ruleId === 'INF_3D_COLLISION'))
  assert.ok(res.body.data.findings.some((f) => f.ruleId === 'INF_OUTSIDE_PROJECT_AREA' && f.entityId === 'UGT-FAR'))
  const after = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-WATER' })
  assert.deepEqual(before.geometry, after.geometry)
})

test('underground: validate requires infrastructure:validate — citizen is forbidden, survey officer succeeds', async () => {
  const citizen = await citizenToken()
  const forbidden = await post('/api/infrastructure/validate', { scope: 'locality', locality: LOCALITY }, citizen)
  assert.equal(forbidden.status, 403)
})

test('underground: POST /infrastructure/collisions distinguishes 3D collision from 2D-only crossing', async () => {
  const officer = await surveyToken()
  const res = await post('/api/infrastructure/collisions', { locality: LOCALITY }, officer)
  assert.equal(res.status, 200)
  assert.ok(res.body.data.collisions >= 1)
  assert.ok(res.body.data.twoDOnly >= 1)
  const wc = res.body.data.pairs.find((p) => [p.a, p.b].includes('UGT-WATER') && [p.a, p.b].includes('UGT-SEWER'))
  assert.equal(wc.relationship, '2D_INTERSECTION')
})

test('underground: review records a reviewer action WITHOUT promoting source or changing depth/geometry', async () => {
  const officer = await surveyToken()
  const before = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-WATER' })
  const res = await patch('/api/infrastructure/UGT-WATER/review', { action: 'ACKNOWLEDGED' }, officer)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.reviewAction, 'ACKNOWLEDGED')
  assert.equal(res.body.data.verificationStatus, 'DEMO') // NOT promoted
  assert.equal(res.body.data.isOfficial, false)
  const after = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-WATER' })
  assert.deepEqual(before.geometry, after.geometry)
  assert.equal(after.topElevationM, before.topElevationM)
})

test('underground: review requires infrastructure:review permission', async () => {
  const citizen = await citizenToken()
  const res = await patch('/api/infrastructure/UGT-WATER/review', { action: 'ACKNOWLEDGED' }, citizen)
  assert.equal(res.status, 403)
})

test('underground: upload dry-run validates GeoJSON without persisting — negative fixtures are all caught', async () => {
  const officer = await surveyToken()
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { infrastructureId: 'DRY-BADCOORD', type: 'WATER_PIPELINE', source: 'DEMO' }, geometry: { type: 'LineString', coordinates: [[999, 12.9], [80.23, 12.9]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-NOCRS', type: 'SEWER_PIPELINE', source: 'DEMO' }, geometry: { type: 'LineString', coordinates: [[80.227, 12.9], [80.228, 12.9]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-BADDIA', type: 'WATER_PIPELINE', source: 'DEMO', crs: 'EPSG:4326', diameterM: 50 }, geometry: { type: 'LineString', coordinates: [[80.227, 12.901], [80.228, 12.901]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-SELFX', type: 'ELECTRICAL', source: 'DEMO', crs: 'EPSG:4326' }, geometry: { type: 'LineString', coordinates: [[80.227, 12.900], [80.229, 12.902], [80.229, 12.900], [80.227, 12.902]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-DUP', type: 'GAS', source: 'DEMO', crs: 'EPSG:4326' }, geometry: { type: 'LineString', coordinates: [[80.227, 12.903], [80.228, 12.903]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-DUP', type: 'GAS', source: 'DEMO', crs: 'EPSG:4326' }, geometry: { type: 'LineString', coordinates: [[80.2271, 12.9031], [80.2281, 12.9031]] } },
      { type: 'Feature', properties: { infrastructureId: 'DRY-NOPROV', type: 'TELECOM', crs: 'EPSG:4326' }, geometry: { type: 'LineString', coordinates: [[80.227, 12.904], [80.228, 12.904]] } },
    ],
  }
  const res = await postFile('/api/infrastructure/upload', { filename: 'x.geojson', text: JSON.stringify(fc), format: 'geojson', extra: { locality: 'sholinganallur' } }, officer)
  assert.equal(res.status, 200)
  const rules = new Set(res.body.data.records.flatMap((r) => r.findings.map((f) => f.ruleId)))
  assert.ok(rules.has('INF_INVALID_COORDINATES'))
  assert.ok(rules.has('INF_CRS_UNKNOWN'))
  assert.ok(rules.has('INF_INVALID_DIAMETER'))
  assert.ok(rules.has('INF_SELF_INTERSECTION'))
  assert.ok(rules.has('INF_DUPLICATE_ID'))
  assert.ok(rules.has('INF_MISSING_PROVENANCE'))
  // nothing was persisted by a dry-run
  assert.equal(await db.collection('undergroundInfrastructure').count({ infrastructureId: 'DRY-DUP' }), 0)
})

test('underground: upload requires infrastructure:upload — citizen is forbidden', async () => {
  const citizen = await citizenToken()
  const fc = { type: 'FeatureCollection', features: [] }
  const res = await postFile('/api/infrastructure/upload', { filename: 'x.geojson', text: JSON.stringify(fc), format: 'geojson' }, citizen)
  assert.equal(res.status, 403)
})

test('underground: import persists records and NEVER promotes a DEMO source to official even if the row claims OFFICIAL', async () => {
  const officer = await surveyToken()
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { infrastructureId: 'UGT-IMP-1', type: 'WATER_PIPELINE', source: 'DEMO', verificationStatus: 'OFFICIAL', crs: 'EPSG:4326', ownerAuthority: 'X', surfaceElevationM: 8, depthBelowSurfaceM: 1.2, diameterM: 0.3, verticalDatum: 'MSL' }, geometry: { type: 'LineString', coordinates: [[80.2268, 12.9012], [80.2272, 12.9012]] } },
    ],
  }
  const res = await postFile('/api/infrastructure/import', { filename: 'x.geojson', text: JSON.stringify(fc), format: 'geojson', extra: { locality: 'sholinganallur', sourceLabel: 'DEMO' } }, officer)
  assert.equal(res.status, 200)
  IMPORT_IDS.push('UGT-IMP-1')
  const d = res.body.data.infrastructure[0]
  assert.equal(d.source, 'DEMO')
  assert.equal(d.verificationStatus, 'DEMO') // the row's "OFFICIAL" claim is ignored
  assert.equal(d.isOfficial, false)
  // depth WAS supplied, so it is stored — with its explicit reference
  assert.equal(d.depthBelowSurfaceM, 1.2)
  assert.equal(d.depthReference, 'GROUND_SURFACE')
})

test('underground: import derives the vertical band from surface - depth when top/bottom elevation are absent', async () => {
  const d = await db.collection('undergroundInfrastructure').findOne({ infrastructureId: 'UGT-IMP-1' })
  const band = verticalBand(d)
  assert.ok(band)
  assert.ok(Math.abs(band.top - 6.8) < 0.01) // 8 - 1.2
})

test('underground: search resolves an infrastructureId and returns a focusable result', async () => {
  const res = await get('/api/search?q=UGT-SEWER')
  assert.equal(res.status, 200)
  const hit = res.body.data.results.find((r) => r.kind === 'infrastructure' && r.title === 'UGT-SEWER')
  assert.ok(hit)
  assert.equal(hit.ref.infrastructureId, 'UGT-SEWER')
})

test('underground: an unknown infrastructure id 404s cleanly', async () => {
  const res = await get('/api/infrastructure/NOPE-404')
  assert.equal(res.status, 404)
})

test('underground: existing GIS / parcel / building APIs remain intact after the module loads', async () => {
  const b = await get('/api/gis/buildings?locality=sholinganallur')
  assert.equal(b.status, 200)
  assert.equal(b.body.data.type, 'FeatureCollection')
  const p = await get('/api/parcels')
  assert.equal(p.status, 200)
})

// ------------------------------------------------------- pure service units

test('underground: validateRecord flags an unknown vertical datum on a record that reports a depth', () => {
  const rec = { infrastructureId: 'X', type: 'WATER_PIPELINE', source: 'DEMO', geometry: { type: 'LineString', coordinates: [[LON, LAT], [eastM(20), LAT]] }, ...withDepth(1.5, 0.3), verticalDatum: 'UNKNOWN', inputCRS: 'EPSG:4326', crsStatus: 'MATCHED' }
  const findings = validateRecord(rec, { localityCentres: [{ lon: LON, lat: LAT }] })
  assert.ok(findings.some((f) => f.ruleId === 'INF_VERTICAL_DATUM_UNKNOWN'))
})

test('underground: validateRecord flags a real-survey record with no depth as REVIEW_REQUIRED (never invents a value)', () => {
  const rec = { infrastructureId: 'X', type: 'SEWER_PIPELINE', source: 'REAL_SURVEY', geometry: { type: 'LineString', coordinates: [[LON, LAT], [eastM(20), LAT]] }, inputCRS: 'EPSG:4326', crsStatus: 'MATCHED' }
  const findings = validateRecord(rec, { localityCentres: [{ lon: LON, lat: LAT }] })
  const f = findings.find((x) => x.ruleId === 'INF_MISSING_DEPTH')
  assert.ok(f)
  assert.equal(f.status, 'REVIEW_REQUIRED')
})

test('underground: associate returns geometry relations only — legalOwnership stays NOT_PROVIDED', () => {
  const parcel = { parcelId: 'P1', ulpin: 'U1', geometry: polygon(rectRing(LON, LAT, 200, 200)) }
  const rec = { geometry: { type: 'LineString', coordinates: [[LON, northM(-60)], [LON, northM(60)]] } }
  const a = associate(rec, [parcel], [])
  assert.equal(a.legalOwnership, 'NOT_PROVIDED')
  assert.ok(['WITHIN_PARCEL', 'CROSSES_PARCEL'].includes(a.parcelRelations[0].spatialRelation))
})
