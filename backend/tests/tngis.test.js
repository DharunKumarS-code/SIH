// TNGIS / Tamil Nilam — PUBLIC-source parcel-geometry integration.
//
// Runs OFFLINE: `TNGIS_LIVE=0` forces the adapter to serve only the bundled
// public-response fixtures (backend/tests/fixtures/tngis/*) + in-memory cache,
// so no request ever leaves the machine and no authenticated endpoint is
// touched. Same harness conventions as tests/underground.test.js.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { normalizeParcel, __resetClientState } from '../src/services/sources/tngis/index.js'
import { relateBuildings } from '../src/services/sources/tngis/relations.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

process.env.TNGIS_LIVE = '0' // fixtures / cache only — belt & braces
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tngis')
const fx = (n) => JSON.parse(readFileSync(path.join(FX, n), 'utf-8'))

let app
let server
let base

const get = async (p, token) => {
  const res = await fetch(base + p, token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = async (p, data, token) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const login = async (u, pw) => (await post('/api/auth/login', { username: u, password: pw })).body.data.token

const Q = { districtCode: '02', talukCode: '11', villageCode: '013', surveyNumber: '234' }
const RECORD_ID = 'tngis:cadastral_ulpin:113214445'

test.before(async () => {
  await connectStore()
  __resetClientState()
  app = createApp()
  await new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r() }) })
})
test.after(async () => {
  await db.collection('tngisParcels').deleteMany({})
  await new Promise((r) => server.close(r))
  await disconnectStore()
})

// ---------------------------------------------------------------- adapter (pure)

test('normalizeParcel: geometry preserved verbatim, EPSG:4326, from the public fixture', () => {
  const geom = fx('geom-02-11-013-234.json')
  const rec = normalizeParcel({
    admin: { ...Q, districtName: 'Chennai', talukName: 'Sholinganallur', villageName: 'Sholinganallur- 1', lgdDistrictCode: '568', lgdTalukCode: '5705', lgdVillageCode: '933868' },
    geom: geom.data,
    wfs: { properties: fx('wfs-cadastral-02-11-013-234.json').features[0].properties, numberMatched: 4 },
    retrievedAt: '2026-09-09T00:00:00.000Z',
  })
  assert.equal(rec.sourceCRS, 'EPSG:4326')
  assert.equal(rec.geometryType, 'MultiPolygon')
  // rings copied unchanged from the source FeatureCollection
  assert.deepEqual(rec.geometry.coordinates[0], geom.data.features[0].geometry.coordinates[0])
  assert.equal(rec.geometry.coordinates.length, 2)
  assert.ok(rec.centroid && Math.abs(rec.centroid.longitude - 80.238) < 0.01)
})

test('normalizeParcel: admin hierarchy + LGD codes carried through', () => {
  const rec = normalizeParcel({
    admin: { ...Q, districtName: 'Chennai', talukName: 'Sholinganallur', villageName: 'Sholinganallur- 1', lgdDistrictCode: '568', lgdTalukCode: '5705', lgdVillageCode: '933868' },
    geom: fx('geom-02-11-013-234.json').data,
    wfs: null,
    retrievedAt: 'x',
  })
  assert.equal(rec.districtCode, '02')
  assert.equal(rec.lgdDistrictCode, '568')
  assert.equal(rec.talukCode, '11')
  assert.equal(rec.lgdTalukCode, '5705')
  assert.equal(rec.villageCode, '013')
  assert.equal(rec.lgdVillageCode, '933868')
  assert.equal(rec.surveyNumber, '234')
})

test('normalizeParcel: provenance block is OFFICIAL_SOURCE / SOURCE_VERIFIED', () => {
  const rec = normalizeParcel({ admin: Q, geom: fx('geom-02-11-013-234.json').data, wfs: null, retrievedAt: 'x' })
  assert.equal(rec.source, 'TNGIS_TAMIL_NILAM')
  assert.equal(rec.sourceType, 'GOVERNMENT_GIS')
  assert.equal(rec.provenance, 'OFFICIAL_SOURCE')
  assert.equal(rec.verificationStatus, 'SOURCE_VERIFIED')
  assert.equal(rec.sourceGeometry, true)
})

test('normalizeParcel: official ULPIN is ALWAYS null + explicit unavailable sentinel', () => {
  const rec = normalizeParcel({ admin: Q, geom: fx('geom-02-11-013-234.json').data, wfs: null, retrievedAt: 'x' })
  assert.equal(rec.officialULPIN, null)
  assert.equal(rec.officialULPINStatus, 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
  // sub-division & area are null (public source did not supply them) — not fabricated
  assert.equal(rec.subDivision, null)
  assert.equal(rec.areaSqm, null)
})

test('normalizeParcel: sourceRecordId + sourceUpdatedAt come from the WFS feature when present', () => {
  const rec = normalizeParcel({
    admin: Q,
    geom: fx('geom-02-11-013-234.json').data,
    wfs: { properties: fx('wfs-cadastral-02-11-013-234.json').features[0].properties },
    retrievedAt: 'x',
  })
  assert.equal(rec.sourceRecordId, RECORD_ID)
  assert.equal(rec.sourceUpdatedAt, '2025-04-08T11:27:24.578Z')
})

test('relateBuildings: reports WITHIN / CROSSES / NEAR, never an ownership claim', () => {
  const parcel = { type: 'Polygon', coordinates: [[[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]]] }
  const inside = { buildingId: 'B_IN', geometry: { type: 'Polygon', coordinates: [[[0.0002, 0.0002], [0.0002, 0.0004], [0.0004, 0.0004], [0.0004, 0.0002], [0.0002, 0.0002]]] } }
  const outside = { buildingId: 'B_OUT', geometry: { type: 'Polygon', coordinates: [[[9, 9], [9, 9.001], [9.001, 9.001], [9.001, 9], [9, 9]]] } }
  const rels = relateBuildings(parcel, [inside, outside])
  const within = rels.find((r) => r.buildingId === 'B_IN')
  assert.equal(within.relationship, 'WITHIN_PARCEL')
  assert.ok(/not an ownership claim/i.test(within.note))
  assert.ok(!rels.some((r) => r.buildingId === 'B_OUT')) // far building not related
})

// ---------------------------------------------------------------- HTTP surface

test('GET /api/tngis/config — public, states CRS + that ULPIN is unavailable', async () => {
  const { status, body } = await get('/api/tngis/config')
  assert.equal(status, 200)
  assert.equal(body.data.sourceCRS, 'EPSG:4326')
  assert.equal(body.data.officialUlpin, 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
  assert.ok(body.data.notIntegratedFields.includes('officialULPIN'))
  assert.ok(body.data.integratedFields.includes('geometry'))
})

test('GET /api/tngis/districts|taluks|villages — public admin hierarchy with LGD codes (fixtures)', async () => {
  const d = await get('/api/tngis/districts')
  assert.equal(d.status, 200)
  const chennai = d.body.data.find((x) => x.name === 'Chennai')
  assert.equal(chennai.districtCode, '02')
  assert.equal(chennai.lgdDistrictCode, '568')

  const t = await get('/api/tngis/taluks?districtCode=02')
  assert.equal(t.status, 200)
  const shln = t.body.data.find((x) => x.name === 'Sholinganallur')
  assert.equal(shln.talukCode, '11')
  assert.equal(shln.lgdTalukCode, '5705')

  const v = await get('/api/tngis/villages?districtCode=02&talukCode=11')
  const v1 = v.body.data.find((x) => x.name === 'Sholinganallur- 1')
  assert.equal(v1.villageCode, '013')
  assert.equal(v1.lgdVillageCode, '933868')
})

test('POST /api/tngis/parcels/fetch — needs auth (RBAC preserved)', async () => {
  const { status } = await post('/api/tngis/parcels/fetch', Q)
  assert.equal(status, 401)
})

test('POST /api/tngis/parcels/fetch — fetches, caches, and NEVER exposes a ULPIN', async () => {
  const token = await login('survey01', 'Officer@123')
  const { status, body } = await post('/api/tngis/parcels/fetch', Q, token)
  assert.equal(status, 200)
  const p = body.data
  assert.equal(p.source, 'TNGIS_TAMIL_NILAM')
  assert.equal(p.provenance, 'OFFICIAL_SOURCE')
  assert.equal(p.verificationStatus, 'SOURCE_VERIFIED')
  assert.equal(p.officialULPIN, null)
  assert.equal(p.officialULPINStatus, 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
  assert.equal(p.sourceCRS, 'EPSG:4326')
  assert.equal(p.geometryType, 'MultiPolygon')
  assert.equal(p.lgdVillageCode, '933868')
  assert.equal(p.surveyNumber, '234')
  assert.ok(p.sourceRecordId.startsWith('tngis:'))
  assert.ok(p.retrievedAt)
})

test('GET /api/tngis/parcels + /:id — cached record, list has pagination meta', async () => {
  const listed = await get('/api/tngis/parcels?limit=10')
  assert.equal(listed.status, 200)
  assert.ok(listed.body.meta.total >= 1)
  const one = listed.body.data[0]
  const byId = await get(`/api/tngis/parcels/${encodeURIComponent(one.sourceRecordId)}`)
  assert.equal(byId.status, 200)
  assert.equal(byId.body.data.sourceRecordId, one.sourceRecordId)
  assert.equal(byId.body.data.officialULPIN, null)
})

test('GET /api/gis/tngis-parcels — GeoJSON layer for the ONE Cesium viewer, EPSG:4326, no ULPIN', async () => {
  const { status, body } = await get('/api/gis/tngis-parcels')
  assert.equal(status, 200)
  assert.equal(body.data.type, 'FeatureCollection')
  const f = body.data.features[0]
  assert.equal(f.properties.kind, 'tngis-parcel')
  assert.equal(f.properties.source, 'TNGIS_TAMIL_NILAM')
  assert.equal(f.properties.provenance, 'OFFICIAL_SOURCE')
  assert.equal(f.properties.officialULPIN, null)
  assert.equal(f.properties.sourceCRS, 'EPSG:4326')
  assert.ok(['MultiPolygon', 'Polygon'].includes(f.geometry.type))
})

test('GET /api/tngis/parcels/:id/relations — building spatial relations, not ownership', async () => {
  const one = (await get('/api/tngis/parcels?limit=1')).body.data[0]
  const { status, body } = await get(`/api/tngis/parcels/${encodeURIComponent(one.sourceRecordId)}/relations`)
  assert.equal(status, 200)
  assert.ok(Array.isArray(body.data.buildingRelations))
  assert.ok(/not establish legal ownership/i.test(body.data.ownershipNote))
})

test('POST /api/tngis/parcels/:id/validate-topology — reuses the Phase 7 engine', async () => {
  const token = await login('survey01', 'Officer@123')
  const one = (await get('/api/tngis/parcels?limit=1')).body.data[0]
  const { status, body } = await post(`/api/tngis/parcels/${encodeURIComponent(one.sourceRecordId)}/validate-topology`, {}, token)
  assert.equal(status, 200)
  assert.ok(body.data.summary)
  assert.ok(typeof body.data.summary.total === 'number')
  assert.ok(Array.isArray(body.data.findings))
})

test('search: a fetched TNGIS parcel is findable by village name / survey number', async () => {
  const r = await get('/api/search?q=Sholinganallur')
  assert.equal(r.status, 200)
  assert.ok(r.body.data.results.some((x) => x.kind === 'tngis-parcel'))
})

// ------------------------------------------------ Chennai-wide viewport (BBOX)

// bbox key the loader builds for the bundled OMR fixture: rounded to 3dp.
const OMR_BBOX = '80.220,12.893,80.247,12.912'
const ANNA_BBOX = '80.198,13.076,80.221,13.094'

test('GET /api/gis/tngis-parcels/bbox — Chennai-wide viewport returns MANY official parcels, no ULPIN', async () => {
  const { status, body } = await get(`/api/gis/tngis-parcels/bbox?bbox=${OMR_BBOX}`)
  assert.equal(status, 200)
  assert.equal(body.data.type, 'FeatureCollection')
  // the OMR fixture holds 50 real public parcels — this is the Chennai-wide fix:
  // the map is no longer limited to one hand-fetched parcel.
  assert.ok(body.data.features.length >= 20, `expected many parcels, got ${body.data.features.length}`)
  assert.equal(body.data.meta.source, 'TNGIS_WFS_VIEWPORT')
  for (const f of body.data.features) {
    assert.equal(f.properties.kind, 'tngis-parcel')
    assert.equal(f.properties.provenance, 'OFFICIAL_SOURCE')
    assert.equal(f.properties.verificationStatus, 'SOURCE_VERIFIED')
    assert.equal(f.properties.officialULPIN, null)
    assert.equal(f.properties.officialULPINStatus, 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
    assert.equal(f.properties.sourceCRS, 'EPSG:4326')
    assert.equal(f.properties.districtCode, '02')
    assert.ok(['MultiPolygon', 'Polygon'].includes(f.geometry.type))
    assert.ok(f.properties.sourceRecordId.startsWith('tngis:'))
  }
  // every parcel is an individual, uniquely-identified feature (not one merged polygon)
  const ids = new Set(body.data.features.map((f) => f.properties.sourceRecordId))
  assert.equal(ids.size, body.data.features.length)
})

test('GET /api/gis/tngis-parcels/bbox — a second Chennai viewport loads a DIFFERENT parcel set', async () => {
  const omr = (await get(`/api/gis/tngis-parcels/bbox?bbox=${OMR_BBOX}`)).body.data
  const anna = (await get(`/api/gis/tngis-parcels/bbox?bbox=${ANNA_BBOX}`)).body.data
  const omrIds = new Set(omr.features.map((f) => f.properties.sourceRecordId))
  const annaIds = new Set(anna.features.map((f) => f.properties.sourceRecordId))
  assert.ok(anna.features.length >= 20)
  // the two viewports are disjoint areas of Chennai — proves it is not one fixed locality
  const overlap = [...annaIds].filter((id) => omrIds.has(id))
  assert.equal(overlap.length, 0)
})

test('GET /api/gis/tngis-parcels/bbox — refuses a viewport wider than the max span (no bulk district download)', async () => {
  const { status, body } = await get('/api/gis/tngis-parcels/bbox?bbox=80.0,12.8,80.5,13.3')
  assert.equal(status, 200)
  assert.equal(body.data.features.length, 0)
  assert.equal(body.data.meta.zoomInRequired, true)
})

test('GET /api/gis/tngis-parcels/bbox — bad bbox is a 400', async () => {
  assert.equal((await get('/api/gis/tngis-parcels/bbox')).status, 400)
  assert.equal((await get('/api/gis/tngis-parcels/bbox?bbox=1,2,3')).status, 400)
})

test('viewport parcels are cached as VIEWPORT_WFS and are inspectable / topology-checkable like any parcel', async () => {
  const fc = (await get(`/api/gis/tngis-parcels/bbox?bbox=${OMR_BBOX}`)).body.data
  const one = fc.features[0].properties.sourceRecordId

  const byId = await get(`/api/tngis/parcels/${encodeURIComponent(one)}`)
  assert.equal(byId.status, 200)
  assert.equal(byId.body.data.officialULPIN, null)
  assert.equal(byId.body.data.discovery, 'VIEWPORT_WFS')

  const token = await login('survey01', 'Officer@123')
  const topo = await post(`/api/tngis/parcels/${encodeURIComponent(one)}/validate-topology`, {}, token)
  assert.equal(topo.status, 200)
  assert.ok(topo.body.data.summary)
})

test('the plain /api/gis/tngis-parcels?excludeViewport=1 layer hides viewport-discovered parcels', async () => {
  await get(`/api/gis/tngis-parcels/bbox?bbox=${OMR_BBOX}`) // populate
  const all = (await get('/api/gis/tngis-parcels')).body.data.features.length
  const explicitOnly = (await get('/api/gis/tngis-parcels?excludeViewport=1')).body.data.features.length
  assert.ok(all > explicitOnly, `all=${all} should exceed explicitOnly=${explicitOnly}`)
})

test('the existing DEMO ULPIN parcel system is untouched', async () => {
  const r = await get('/api/parcels/TN-CHN-123456789')
  assert.equal(r.status, 200)
  assert.equal(r.body.data.parcel.ulpin, 'TN-CHN-123456789')
  // still DEMO — the TNGIS integration did not promote or alter it
  assert.notEqual(r.body.data.provenance?.verificationStatus, 'SOURCE_VERIFIED')
})

test('no credentials / tokens are ever persisted on a TNGIS parcel', async () => {
  const rows = await db.collection('tngisParcels').find({})
  for (const row of rows) {
    const json = JSON.stringify(row).toLowerCase()
    for (const bad of ['password', 'authorization', 'x-csrf-token', 'x-session-id', 'sessionid', 'bearer ', 'cookie']) {
      assert.ok(!json.includes(bad), `stored TNGIS parcel must not contain "${bad}"`)
    }
  }
})
