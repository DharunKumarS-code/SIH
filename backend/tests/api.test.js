import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore } from '../src/store/index.js'
import { PARCEL_ULPIN, makeProtoPropertyId } from '../src/services/idService.js'

let app
let server
let base

test.before(async () => {
  await connectStore()
  app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`
      resolve()
    })
  })
})

test.after(() => server?.close())

const get = async (path, token) => {
  const res = await fetch(base + path, token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
  return { status: res.status, body: await res.json() }
}
const post = async (path, data, token) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: await res.json() }
}

test('health + api root', async () => {
  assert.equal((await get('/health')).status, 200)
  assert.equal((await get('/api')).body.name, 'LAND STACK API')
})

test('auth: login demo officer, /me returns role + permissions', async () => {
  const login = await post('/api/auth/login', { username: 'land01', password: 'Officer@123' })
  assert.equal(login.status, 200)
  assert.ok(login.body.data.token)
  assert.equal(login.body.data.user.role, 'Land Officer')
  const me = await get('/api/auth/me', login.body.data.token)
  assert.equal(me.status, 200)
  assert.ok(Array.isArray(me.body.data.permissions))
})

test('auth: bad password rejected', async () => {
  assert.equal((await post('/api/auth/login', { username: 'land01', password: 'nope' })).status, 401)
})

test('auth: register new citizen then login', async () => {
  const u = `tester_${Date.now().toString(36)}`
  const reg = await post('/api/auth/register', { username: u, name: 'Test User', email: `${u}@demo.test`, password: 'secret123' })
  assert.equal(reg.status, 200)
  assert.equal(reg.body.data.user.role, 'Citizen')
})

test('rbac: citizen cannot verify a parcel (403)', async () => {
  const login = await post('/api/auth/login', { username: 'citizen01', password: 'Citizen@123' })
  const res = await post(`/api/parcels/${PARCEL_ULPIN}/verify`, {}, login.body.data.token)
  assert.equal(res.status, 403)
})

test('rbac: land officer can verify a unit (200) and it is audited', async () => {
  const login = await post('/api/auth/login', { username: 'land01', password: 'Officer@123' })
  const pid = makeProtoPropertyId(PARCEL_ULPIN, 1, 3, '301')
  const res = await post(`/api/units/${pid}/verify`, {}, login.body.data.token)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.unit.status, 'Verified')
  const audit = await get(`/api/audit?entityId=${encodeURIComponent(pid)}`, login.body.data.token)
  assert.ok(audit.body.data.some((a) => a.action === 'PROPERTY_VERIFIED'))
})

test('parcels: list + fetch primary ULPIN with buildings', async () => {
  const listed = await get('/api/parcels')
  assert.ok(listed.body.data.length >= 12)
  const one = await get(`/api/parcels/${PARCEL_ULPIN}`)
  assert.equal(one.status, 200)
  assert.equal(one.body.data.parcel.ulpin, PARCEL_ULPIN)
  assert.equal(one.body.data.buildings.length, 5)
})

test('hierarchy: building -> floors -> unit U201 resolves the exact spec id', async () => {
  const bId = `${PARCEL_ULPIN}-B01`
  const b = await get(`/api/buildings/${bId}`)
  assert.equal(b.status, 200)
  assert.ok(b.body.data.floors.length >= 10)

  const floorId = `${bId}-F02`
  const floor = await get(`/api/floors/${floorId}`)
  assert.equal(floor.status, 200)
  assert.ok(floor.body.data.units.length >= 4)

  const pid = 'TN-CHN-123456789-B01-F02-U201'
  const unit = await get(`/api/units/${pid}`)
  assert.equal(unit.status, 200)
  assert.equal(unit.body.data.unit.propertyId, pid)
  assert.equal(unit.body.data.hierarchy.ulpin, PARCEL_ULPIN)
  assert.equal(unit.body.data.hierarchy.building.segment, 'B01')
  assert.equal(unit.body.data.hierarchy.floor.number, 2)
  assert.equal(unit.body.data.unit.idKind, 'Prototype 3D Property Identifier')
  assert.ok(unit.body.data.unit.owner.name)
})

test('unit: invalid proto id gives a helpful 404', async () => {
  const res = await get('/api/units/NOT-A-VALID-ID')
  assert.equal(res.status, 404)
})

test('governance: ror / registration / encumbrance / tax / approval', async () => {
  assert.equal((await get(`/api/ror/${PARCEL_ULPIN}`)).status, 200)
  assert.equal((await get(`/api/registration/${PARCEL_ULPIN}`)).status, 200)
  assert.equal((await get(`/api/encumbrance/${PARCEL_ULPIN}`)).status, 200)
  assert.equal((await get(`/api/property-tax/${PARCEL_ULPIN}`)).status, 200)
  assert.equal((await get(`/api/building-approval/${PARCEL_ULPIN}-B02`)).status, 200)
})

test('interoperability: unified record aggregates every department with the standard envelope', async () => {
  const res = await get(`/api/interop/${PARCEL_ULPIN}`)
  assert.equal(res.status, 200)
  const depts = res.body.data.departments
  for (const key of ['LandRecords', 'Registration', 'Planning', 'PropertyTax', 'Disputes', 'Utilities']) {
    assert.ok(depts[key], `missing ${key}`)
    assert.equal(depts[key].ulpin, PARCEL_ULPIN)
    assert.ok(depts[key].timestamp)
    assert.match(depts[key].integration, /DEMO|MOCK/)
  }
})

test('gis: parcels / buildings / units return GeoJSON FeatureCollections', async () => {
  const p = await get('/api/gis/parcels')
  assert.equal(p.body.data.type, 'FeatureCollection')
  const u = await get(`/api/gis/units?buildingId=${PARCEL_ULPIN}-B01`)
  assert.equal(u.body.data.type, 'FeatureCollection')
  assert.ok(u.body.data.features.length >= 60) // ~10 floors * 6 units
  assert.ok(u.body.data.features[0].properties.propertyId.startsWith('TN-CHN-123456789-B01-'))
  assert.ok(u.body.data.features[0].properties.baseHeight >= 0)
})

test('dashboard + analytics stats', async () => {
  const d = await get('/api/dashboard/stats')
  assert.equal(d.status, 200)
  assert.ok(d.body.data.kpis.totalUnits > 200)
  assert.ok(Array.isArray(d.body.data.charts.landUseDistribution))
  const a = await get('/api/analytics')
  assert.equal(a.status, 200)
  assert.ok(a.body.data.heatmap.length === 5)
})

test('search resolves a full proto id straight to the unit', async () => {
  const res = await get('/api/search?q=TN-CHN-123456789-B01-F02-U201')
  assert.equal(res.status, 200)
  assert.ok(res.body.data.results.some((r) => r.kind === 'unit' && r.ref.propertyId === 'TN-CHN-123456789-B01-F02-U201'))
})

test('ai: status + one mock inference is clearly labelled demo', async () => {
  const st = await get('/api/ai/status')
  assert.equal(st.status, 200)
  assert.ok(['demo', 'connected'].includes(st.body.data.mode))
  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const inf = await post('/api/ai/height-estimation', { ulpin: PARCEL_ULPIN }, login.body.data.token)
  assert.equal(inf.status, 200)
  assert.equal(inf.body.data.mode, 'demo')
  assert.match(inf.body.data.disclaimer, /Demo/)
})

test('citizen service request workflow: create then officer advances stage', async () => {
  const citizen = await post('/api/auth/login', { username: 'citizen01', password: 'Citizen@123' })
  const created = await post(
    '/api/services',
    { type: 'Ownership Verification', ulpin: PARCEL_ULPIN, propertyId: 'TN-CHN-123456789-B01-F02-U202', note: 'please verify' },
    citizen.body.data.token,
  )
  assert.equal(created.status, 200)
  const id = created.body.data.request.requestId

  const officer = await post('/api/auth/login', { username: 'land01', password: 'Officer@123' })
  const adv = await post(`/api/services/${id}/advance`, { note: 'docs ok' }, officer.body.data.token)
  assert.equal(adv.status, 200)
  assert.notEqual(adv.body.data.request.stage, 'Submitted')
})

test('system status never claims live government connectivity', async () => {
  const res = await get('/api/system/status')
  assert.equal(res.status, 200)
  assert.match(JSON.stringify(res.body.data.services), /Demo|demo/)
  assert.match(res.body.data.disclaimer, /No live government connectivity/)
})
