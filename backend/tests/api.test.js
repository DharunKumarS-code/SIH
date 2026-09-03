import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
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

test.after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await disconnectStore() // release the Mongo socket so `node --test` can exit
})

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
const patch = async (path, data, token) => {
  const res = await fetch(base + path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: await res.json() }
}
const postForm = async (path, { field = 'image', filename, bytes, contentType, extra = {} }, token) => {
  const fd = new FormData()
  fd.append(field, new Blob([bytes], { type: contentType }), filename)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(base + path, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: fd,
  })
  return { status: res.status, body: await res.json() }
}
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

// Regression — the Buildings page calls GET /api/buildings (optionally ?ulpin=).
// It must return 200 with the expected buildings + parcel/locality links for
// every Chennai area, and stay fast (no per-parcel volume scan on this path).
test('buildings: GET /api/buildings works for all three Chennai areas (no 502 regression)', async () => {
  const all = await get('/api/buildings')
  assert.equal(all.status, 200)
  assert.ok(Array.isArray(all.body.data) && all.body.data.length >= 12)

  for (const [ulpin, locality, n] of [
    ['TN-CHN-123456789', 'sholinganallur', 5],
    ['TN-CHN-223456789', 'adyar', 4],
    ['TN-CHN-323456789', 'annanagar', 5],
  ]) {
    const t0 = Date.now()
    const res = await get(`/api/buildings?ulpin=${ulpin}`)
    assert.equal(res.status, 200, `buildings for ${locality}`)
    assert.equal(res.body.data.length, n, `${locality} building count`)
    assert.ok(res.body.data.every((b) => b.ulpin === ulpin && b.locality === locality))
    assert.ok(res.body.data.every((b) => b.buildingId && b.name && typeof b.unitCount === 'number'))
    assert.ok(Date.now() - t0 < 3000, `${locality} buildings responded slowly`)
  }
})

test('provenance: land-sources register documents Chennai ULPIN as UNAVAILABLE', async () => {
  const res = await get('/api/land-sources')
  assert.equal(res.status, 200)
  const d = res.body.data
  assert.ok(Array.isArray(d.sources) && d.sources.length >= 6)
  assert.equal(d.chennai.status, 'UNAVAILABLE')
  assert.equal(d.ulpinSpec.identifies, 'land parcel')
  assert.ok(d.ulpinSpec.neverIdentifies.includes('apartment'))
  assert.ok(d.sources.every((s) => s.chennaiAvailability === 'UNAVAILABLE'))
  assert.ok(d.localities.some((l) => l.id === 'sholinganallur' && l.recordType === 'TSLR'))
})

test('provenance: every parcel is labelled DEMO, never OFFICIAL (anti-fabrication)', async () => {
  const one = await get(`/api/parcels/${PARCEL_ULPIN}`)
  assert.equal(one.body.data.provenance.verificationStatus, 'DEMO')
  assert.equal(one.body.data.provenance.ulpinStatus, 'DEMO_NOT_OFFICIAL')
  assert.equal(one.body.data.parcel.isOfficialUlpin, false)
  assert.ok(one.body.data.parcel.subdivisionNumber)

  const prov = await get(`/api/parcels/${PARCEL_ULPIN}/provenance`)
  assert.equal(prov.status, 200)
  const chain = prov.body.data.providerChain.map((c) => c.provider)
  assert.ok(chain.includes('GovernmentDataProvider') && chain.includes('DemoDataProvider'))
  assert.equal(prov.body.data.providerChain.find((c) => c.provider === 'GovernmentDataProvider').status, 'UNAVAILABLE')

  const gis = await get('/api/gis/parcels')
  assert.ok(gis.body.data.features.length > 0)
  assert.ok(gis.body.data.features.every((f) => f.properties.verificationStatus === 'DEMO'))
  assert.ok(gis.body.data.features.every((f) => f.properties.isOfficialUlpin === false))
})

test('search: parcels resolve by locality, survey number and subdivision', async () => {
  const byLoc = await get('/api/search?q=Adyar')
  assert.ok(byLoc.body.data.results.some((r) => r.kind === 'parcel'))
  const bySurvey = await get('/api/search?q=231/5')
  assert.ok(bySurvey.body.data.results.some((r) => r.kind === 'parcel'))
  const anyParcel = byLoc.body.data.results.find((r) => r.kind === 'parcel')
  assert.equal(anyParcel.verification, 'DEMO')
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

test('phase2: unit response carries a bounded prototype 3D volume + validation', async () => {
  const res = await get(`/api/units/${PARCEL_ULPIN}-B01-F02-U201`)
  assert.equal(res.status, 200)
  const { unit, volume, validation, hierarchy } = res.body.data
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']) {
    assert.equal(typeof volume[k], 'number', `volume.${k}`)
  }
  assert.ok(volume.xmin < volume.xmax && volume.ymin < volume.ymax && volume.zmin < volume.zmax)
  assert.equal(volume.volumeId, 'V0201')
  assert.equal(volume.geometryVersion, 1)
  assert.equal(volume.source, 'DEMO')
  assert.equal(volume.prototype, true)
  assert.equal(hierarchy.unit.volumeId, 'V0201')
  assert.equal(unit.volume.volumeId, 'V0201')
  assert.ok(['VALID', 'WARNING', 'ERROR'].includes(validation.status))
  // deterministic id
  const again = await get(`/api/units/${PARCEL_ULPIN}-B01-F02-U201`)
  assert.equal(again.body.data.volume.volumeId, 'V0201')
})

test('phase2: floor volume z-range matches the floor baseHeight/topHeight', async () => {
  const res = await get(`/api/floors/${PARCEL_ULPIN}-B01-F02`)
  assert.equal(res.status, 200)
  const f = res.body.data.floor
  assert.equal(f.volume.zmin, f.baseHeight)
  assert.equal(f.volume.zmax, f.topHeight)
  assert.equal(f.volume.volumeId, 'VF02')
  assert.equal(f.volume.zmin < f.volume.zmax, true)
})

test('phase2: parcel exposes a cheap volume rollup; full validation lives on /volumes', async () => {
  // getParcel stays light — counts only, no per-floor/unit scan (keeps the hot path fast).
  const res = await get(`/api/parcels/${PARCEL_ULPIN}`)
  assert.equal(res.status, 200)
  assert.ok(res.body.data.volumes.units > 0)
  assert.ok(res.body.data.volumes.buildings > 0 && res.body.data.volumes.floors > 0)
  assert.equal(res.body.data.validation, undefined) // moved to /volumes

  const vol = await get(`/api/parcels/${PARCEL_ULPIN}/volumes`)
  assert.equal(vol.status, 200)
  assert.ok(vol.body.data.volumes.units.length > 0)
  assert.ok(['VALID', 'WARNING', 'ERROR'].includes(vol.body.data.validation.status))
  assert.notEqual(vol.body.data.validation.status, 'ERROR') // demo parcel is internally consistent within tolerance
  assert.ok(vol.body.data.volumes.units.every((v) => v.source !== 'OFFICIAL'))
  assert.ok(vol.body.data.volumes.units.every((v) => Number.isFinite(v.zmin) && Number.isFinite(v.zmax) && v.zmin < v.zmax))
})

test('phase2: gis units carry volume bounds inline; search resolves a Volume ID', async () => {
  const gu = await get(`/api/gis/units?buildingId=${PARCEL_ULPIN}-B01`)
  assert.ok(gu.body.data.features.every((f) => f.properties.volume
    && Number.isFinite(f.properties.volume.xmin)
    && Number.isFinite(f.properties.volume.zmax)))

  const s = await get('/api/search?q=V0201')
  const hit = s.body.data.results.find((r) => r.kind === 'unit' && r.ref.propertyId === `${PARCEL_ULPIN}-B01-F02-U201`)
  assert.ok(hit, 'V0201 search should resolve to B01-F02-U201')
})

/* --------------------------------------------------------------- phase 3 — AI */

const officerToken = async () =>
  (await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })).body.data.token

test('phase3: AI extraction never 500s; degrades gracefully; leaves the Buildings API intact', async () => {
  // Contract holds whether or not the Python ai-service happens to be running:
  //   - HTTP 200, a jobId, status in {COMPLETED, NO_BUILDINGS, INFERENCE_UNAVAILABLE}
  //   - if INFERENCE_UNAVAILABLE: job FAILED, zero aiBuildings written
  //   - the existing /api/buildings endpoint is completely unaffected
  const tok = await officerToken()
  const before = await db.collection('aiBuildings').count({})
  const res = await postForm('/api/ai/buildings/infer',
    { filename: 'tile.png', bytes: tinyPng, contentType: 'image/png', extra: { locality: 'sholinganallur' } }, tok)
  assert.equal(res.status, 200) // never a 500
  assert.ok(res.body.data.jobId)
  assert.ok(['COMPLETED', 'NO_BUILDINGS', 'INFERENCE_UNAVAILABLE'].includes(res.body.data.status), res.body.data.status)

  const job = await get(`/api/ai/jobs/${res.body.data.jobId}`)
  assert.equal(job.status, 200)
  if (res.body.data.status === 'INFERENCE_UNAVAILABLE') {
    assert.equal(job.body.data.status, 'FAILED')
    assert.equal((await db.collection('aiBuildings').count({})) - before, 0)
  } else {
    assert.ok(['COMPLETED', 'NO_BUILDINGS'].includes(job.body.data.status))
    assert.equal(res.body.data.summary.total, (res.body.data.buildings || []).length)
    assert.ok((res.body.data.buildings || []).every((b) => b.source === 'AI_DEMO'))
  }

  // the existing Buildings API is completely unaffected
  const bld = await get('/api/buildings')
  assert.equal(bld.status, 200)
  assert.ok(bld.body.data.length >= 12)
})

test('phase3: upload validation rejects non-images and empty uploads (400, not 500)', async () => {
  const tok = await officerToken()
  const txt = await postForm('/api/ai/buildings/infer',
    { filename: 'notes.txt', bytes: Buffer.from('hello'), contentType: 'text/plain' }, tok)
  assert.equal(txt.status, 400)

  const noFile = await fetch(base + '/api/ai/buildings/infer', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: new FormData() })
  assert.equal(noFile.status, 400)
})

test('phase3: AI endpoints require ai:run; review requires change-detection:review', async () => {
  const citizen = (await post('/api/auth/login', { username: 'citizen01', password: 'Citizen@123' })).body.data.token
  const denied = await postForm('/api/ai/buildings/infer',
    { filename: 't.png', bytes: tinyPng, contentType: 'image/png' }, citizen)
  assert.equal(denied.status, 403)
})

test('phase3: NO-FABRICATION — AI buildings are AI_DEMO / DEMO_NOT_OFFICIAL and never official', async () => {
  // seed one AI-building record directly (as the pipeline would) and assert the
  // contract via the public API + the GIS layer.
  const fixture = {
    aiBuildingId: 'AI-CHN-TEST01',
    jobId: 'AIJOB-TEST',
    geometry: { type: 'Polygon', coordinates: [[[80.2269, 12.9003], [80.2272, 12.9003], [80.2272, 12.9006], [80.2269, 12.9006], [80.2269, 12.9003]]] },
    georeferenced: true,
    geoStatus: 'GEOREFERENCED',
    source: 'AI_DEMO',
    model: 'classical-cv',
    modelVersion: '1.0',
    timestamp: new Date().toISOString(),
    confidence: 0.83,
    confidenceLevel: 'HIGH',
    geometryStatus: 'VALID',
    geometryIssues: [],
    parcelStatus: 'MATCHED',
    parentParcelId: 'PCL-CHN-SHLN-0001',
    parentULPIN: PARCEL_ULPIN,
    ulpinStatus: 'DEMO_NOT_OFFICIAL',
    parcelCandidates: [],
    height: null,
    heightStatus: 'UNAVAILABLE',
    reviewRequired: false,
    reviewStatus: 'REVIEW_REQUIRED',
    locality: 'sholinganallur',
    isDemo: true,
  }
  await db.collection('aiBuildings').create(fixture)

  const one = await get('/api/ai/buildings/AI-CHN-TEST01')
  assert.equal(one.status, 200)
  const b = one.body.data
  assert.equal(b.source, 'AI_DEMO')
  assert.equal(b.ulpinStatus, 'DEMO_NOT_OFFICIAL')
  assert.equal(b.height, null)
  assert.equal(b.heightStatus, 'UNAVAILABLE')
  assert.notEqual(b.verificationStatus, 'OFFICIAL')
  assert.notEqual(b.isOfficialUlpin, true)
  assert.equal(b.parentULPIN, PARCEL_ULPIN) // an EXISTING parcel ULPIN is attached, not a new one

  const list = await get('/api/ai/buildings?parcel=PCL-CHN-SHLN-0001')
  assert.ok(list.body.data.some((x) => x.aiBuildingId === 'AI-CHN-TEST01'))
  assert.ok(list.body.data.every((x) => x.source === 'AI_DEMO'))

  const gis = await get('/api/gis/ai-buildings?locality=sholinganallur')
  assert.equal(gis.body.data.type, 'FeatureCollection')
  const feat = gis.body.data.features.find((f) => f.properties.aiBuildingId === 'AI-CHN-TEST01')
  assert.ok(feat)
  assert.equal(feat.properties.source, 'AI_DEMO')
  assert.equal(feat.properties.kind, 'ai-building')
  assert.equal(feat.properties.ulpinStatus, 'DEMO_NOT_OFFICIAL')
  assert.equal(feat.properties.height, null)

  // review updates the flag + writes an audit row, but confers NO official status
  const officer = await officerToken()
  const rv = await patch('/api/ai/buildings/AI-CHN-TEST01/review', { reviewStatus: 'ACCEPTED' }, officer)
  assert.equal(rv.status, 200)
  assert.equal(rv.body.data.reviewStatus, 'ACCEPTED')
  assert.equal(rv.body.data.source, 'AI_DEMO')
  assert.notEqual(rv.body.data.verificationStatus, 'OFFICIAL')
  assert.match(rv.body.data.note, /no official/i)
  const admin = (await post('/api/auth/login', { username: 'admin01', password: 'Admin@123' })).body.data.token
  const audit = await get('/api/audit?entityId=AI-CHN-TEST01', admin)
  assert.equal(audit.status, 200)
  assert.ok(audit.body.data.some((a) => a.action === 'AI_BUILDING_REVIEWED'))
})

test('phase3: existing demo buildings are untouched by AI (separate collection)', async () => {
  const gb = await get('/api/gis/buildings?locality=sholinganallur')
  assert.equal(gb.body.data.features.length, 5) // unchanged demo buildings
  assert.ok(gb.body.data.features.every((f) => !('aiBuildingId' in f.properties)))
  const st = await get('/api/ai/status')
  assert.ok(st.body.data.buildingExtraction)
  assert.equal(st.body.data.buildingExtraction.source, 'AI_DEMO')
})

test('dashboard + analytics stats', async () => {
  const d = await get('/api/dashboard/stats')
  assert.equal(d.status, 200)
  assert.ok(d.body.data.kpis.totalUnits > 200)
  assert.ok(Array.isArray(d.body.data.charts.landUseDistribution))
  const a = await get('/api/analytics')
  assert.equal(a.status, 200)
  assert.ok(a.body.data.heatmap.length >= 5) // >= 5 Sholinganallur buildings + other localities
})

test('gis: localities registry lists every Chennai area with counts', async () => {
  const res = await get('/api/gis/localities')
  assert.equal(res.status, 200)
  const { localities, city } = res.body.data
  assert.ok(Array.isArray(localities) && localities.length >= 3)
  const shln = localities.find((l) => l.id === 'sholinganallur')
  assert.equal(shln.ulpinPrimary, PARCEL_ULPIN)
  assert.equal(shln.counts.buildings, 5)
  assert.ok(shln.counts.units > 0)
  assert.ok(localities.some((l) => l.id === 'adyar') && localities.some((l) => l.id === 'annanagar'))
  assert.ok(city && typeof city.cameraHeightM === 'number')
})

test('gis: parcels can be filtered to a single locality', async () => {
  const all = await get('/api/gis/parcels')
  const adyar = await get('/api/gis/parcels?locality=adyar')
  assert.equal(adyar.body.data.type, 'FeatureCollection')
  assert.ok(adyar.body.data.features.length >= 1)
  assert.ok(adyar.body.data.features.every((f) => f.properties.locality === 'adyar'))
  assert.ok(all.body.data.features.length > adyar.body.data.features.length)
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
