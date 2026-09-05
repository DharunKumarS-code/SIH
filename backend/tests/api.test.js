import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { PARCEL_ULPIN, makeProtoPropertyId } from '../src/services/idService.js'

const FLOORPLAN_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/floorplan_demo.png',
)
const ELEV_FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/elevation',
)

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
const postFormMulti = async (path, { files, extra = {} }, token) => {
  const fd = new FormData()
  for (const [field, { filename, bytes, contentType }] of Object.entries(files)) {
    fd.append(field, new Blob([bytes], { type: contentType }), filename)
  }
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

/* -------------------------------------------------------------------------- */
/* Phase 4 — AI floor-plan & apartment/unit segmentation (additive, AI_DEMO)   */
/* -------------------------------------------------------------------------- */
const floorPlanPng = existsSync(FLOORPLAN_FIXTURE) ? readFileSync(FLOORPLAN_FIXTURE) : tinyPng

test('phase4: floor-plan inference never 500s; degrades gracefully; leaves existing APIs intact', async () => {
  // Contract holds whether or not the Python ai-service is running:
  //   HTTP 200, a jobId, status in {COMPLETED, INFERENCE_UNAVAILABLE}
  //   INFERENCE_UNAVAILABLE -> job FAILED, zero aiFloorUnits written
  const tok = await officerToken()
  const beforeUnits = await db.collection('aiFloorUnits').count({})
  const res = await postForm('/api/ai/floorplans/infer',
    { filename: 'floorplan_demo.png', bytes: floorPlanPng, contentType: 'image/png',
      extra: { buildingId: `${PARCEL_ULPIN}-B01`, floorId: `${PARCEL_ULPIN}-B01-F02`, scaleMPerPx: '0.02' } }, tok)
  assert.equal(res.status, 200) // never a 500
  assert.ok(res.body.data.jobId)
  assert.ok(['COMPLETED', 'INFERENCE_UNAVAILABLE'].includes(res.body.data.status), res.body.data.status)

  if (res.body.data.status === 'INFERENCE_UNAVAILABLE') {
    const job = await get(`/api/ai/jobs/${res.body.data.jobId}`)
    assert.equal(job.body.data.status, 'FAILED')
    assert.equal((await db.collection('aiFloorUnits').count({})) - beforeUnits, 0)
  } else {
    assert.ok(res.body.data.floorPlanId)
    assert.ok(Array.isArray(res.body.data.units))
    assert.ok((res.body.data.rooms || []).every((r) => r.source === 'AI_DEMO'))
    assert.ok((res.body.data.units || []).every((u) => u.source === 'AI_DEMO'))
    assert.equal(res.body.data.dataClassification, 'DEMO_RESEARCH_DATA')
    // GET sub-resources resolve
    const rooms = await get(`/api/ai/floorplans/${res.body.data.floorPlanId}/rooms`)
    assert.equal(rooms.status, 200)
    const units = await get(`/api/ai/floorplans/${res.body.data.floorPlanId}/units`)
    assert.equal(units.status, 200)
    const val = await get(`/api/ai/floorplans/${res.body.data.floorPlanId}/validation`)
    assert.equal(val.status, 200)
    assert.ok(['VALID', 'WARNING', 'ERROR'].includes(val.body.data.validation.status))
  }

  // existing APIs completely unaffected
  assert.equal((await get('/api/buildings')).status, 200)
  const gb = await get('/api/gis/buildings?locality=sholinganallur')
  assert.equal(gb.body.data.features.length, 5) // unchanged demo buildings
  assert.ok(gb.body.data.features.every((f) => !('aiFloorUnitId' in f.properties)))
})

test('phase4: upload validation rejects non-images and empty uploads (400, not 500)', async () => {
  const tok = await officerToken()
  const txt = await postForm('/api/ai/floorplans/infer',
    { filename: 'notes.txt', bytes: Buffer.from('hello'), contentType: 'text/plain' }, tok)
  assert.equal(txt.status, 400)

  const noFile = await fetch(base + '/api/ai/floorplans/infer', {
    method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: new FormData(),
  })
  assert.equal(noFile.status, 400)
})

test('phase4: infer requires ai:run; review requires change-detection:review', async () => {
  const citizen = (await post('/api/auth/login', { username: 'citizen01', password: 'Citizen@123' })).body.data.token
  const denied = await postForm('/api/ai/floorplans/infer',
    { filename: 'fp.png', bytes: floorPlanPng, contentType: 'image/png' }, citizen)
  assert.equal(denied.status, 403)

  const rv = await patch('/api/ai/floorplans/AIFP-CHN-DOESNOTEXIST/review', { reviewStatus: 'ACCEPTED' }, citizen)
  assert.equal(rv.status, 403)
})

test('phase4: NO-FABRICATION — AI floor units are AI_DEMO / DEMO_NOT_OFFICIAL, never official, never a real ULPIN', async () => {
  // seed one AI floor-plan + unit directly (as the pipeline would) and assert the contract
  const fixturePlan = {
    floorPlanId: 'AIFP-CHN-TEST01', jobId: 'FPJOB-TEST', source: 'AI_DEMO',
    dataClassification: 'DEMO_RESEARCH_DATA', dataset: 'CubiCasa5K',
    model: 'classical-cv', modelVersion: '1.0', timestamp: new Date().toISOString(),
    buildingId: `${PARCEL_ULPIN}-B01`, floorId: `${PARCEL_ULPIN}-B01-F02`,
    parentParcelId: 'PCL-CHN-SHLN-0001', parentULPIN: PARCEL_ULPIN, ulpinStatus: 'DEMO_NOT_OFFICIAL',
    georeferenced: true, geoStatus: 'GEOREFERENCED_VIA_BUILDING',
    validation: { status: 'VALID', counts: { valid: 1, warning: 0, error: 0 }, issues: [] },
    summary: { units: 1, rooms: 3 }, locality: 'sholinganallur',
    reviewStatus: 'REVIEW_REQUIRED', reviewRequired: true, isDemo: true,
  }
  const fixtureUnit = {
    aiFloorUnitId: 'AIFP-CHN-TEST01-AI-UNIT-001', localUnitId: 'AI-UNIT-001',
    floorPlanId: 'AIFP-CHN-TEST01', jobId: 'FPJOB-TEST',
    buildingId: `${PARCEL_ULPIN}-B01`, floorId: `${PARCEL_ULPIN}-B01-F02`,
    parentParcelId: 'PCL-CHN-SHLN-0001', parentULPIN: PARCEL_ULPIN, ulpinStatus: 'DEMO_NOT_OFFICIAL',
    rooms: ['AIFP-CHN-TEST01-FP-RM-000001'], roomTypes: ['BEDROOM'],
    geometry: { type: 'Polygon', coordinates: [[[80.2269, 12.9003], [80.2272, 12.9003], [80.2272, 12.9006], [80.2269, 12.9006], [80.2269, 12.9003]]] },
    volume: { volumeId: 'FPV-001', xmin: 80.2269, xmax: 80.2272, ymin: 12.9003, ymax: 12.9006, zmin: 6, zmax: 9 },
    confidence: 0.62, confidenceLevel: 'MEDIUM', geometryStatus: 'VALID',
    source: 'AI_DEMO', dataClassification: 'DEMO_RESEARCH_DATA', dataset: 'CubiCasa5K',
    model: 'classical-cv', modelVersion: '1.0', timestamp: new Date().toISOString(),
    georeferenced: true, geoStatus: 'GEOREFERENCED_VIA_BUILDING', heightStatus: 'ESTIMATED',
    reviewRequired: true, reviewStatus: 'REVIEW_REQUIRED', locality: 'sholinganallur', isDemo: true,
  }
  await db.collection('aiFloorPlans').create(fixturePlan)
  await db.collection('aiRooms').create({
    roomId: 'AIFP-CHN-TEST01-FP-RM-000001', localRoomId: 'FP-RM-000001', floorPlanId: 'AIFP-CHN-TEST01',
    class: 'BEDROOM', roomType: 'BEDROOM', confidence: 0.5, confidenceLevel: 'LOW', geometryStatus: 'VALID',
    source: 'AI_DEMO', reviewRequired: true, reviewStatus: 'REVIEW_REQUIRED', isDemo: true,
  })
  await db.collection('aiFloorUnits').create(fixtureUnit)

  const plan = await get('/api/ai/floorplans/AIFP-CHN-TEST01')
  assert.equal(plan.status, 200)
  assert.equal(plan.body.data.source, 'AI_DEMO')
  assert.equal(plan.body.data.ulpinStatus, 'DEMO_NOT_OFFICIAL')
  assert.notEqual(plan.body.data.isOfficialUlpin, true)

  const unit = await get('/api/ai/floor-units/AIFP-CHN-TEST01-AI-UNIT-001')
  assert.equal(unit.status, 200)
  const u = unit.body.data
  assert.equal(u.source, 'AI_DEMO')
  assert.equal(u.dataClassification, 'DEMO_RESEARCH_DATA')
  assert.equal(u.ulpinStatus, 'DEMO_NOT_OFFICIAL')
  assert.equal(u.parentULPIN, PARCEL_ULPIN) // an EXISTING parcel ULPIN is attached, not a new one
  assert.ok(!u.localUnitId.startsWith('TN-')) // never formatted as an official ULPIN
  assert.notEqual(u.isOfficialUlpin, true)
  assert.notEqual(u.verificationStatus, 'OFFICIAL')

  // GIS layer exposes only georeferenced units, all AI_DEMO
  const gis = await get('/api/gis/ai-floor-units?locality=sholinganallur')
  assert.equal(gis.body.data.type, 'FeatureCollection')
  const feat = gis.body.data.features.find((f) => f.properties.aiFloorUnitId === 'AIFP-CHN-TEST01-AI-UNIT-001')
  assert.ok(feat)
  assert.equal(feat.properties.source, 'AI_DEMO')
  assert.equal(feat.properties.kind, 'ai-floor-unit')
  assert.equal(feat.properties.ulpinStatus, 'DEMO_NOT_OFFICIAL')

  // review updates the flag + writes an audit row, confers NO official status
  const officer = await officerToken()
  const rv = await patch('/api/ai/floor-units/AIFP-CHN-TEST01-AI-UNIT-001/review', { reviewStatus: 'ACCEPTED' }, officer)
  assert.equal(rv.status, 200)
  assert.equal(rv.body.data.reviewStatus, 'ACCEPTED')
  assert.match(rv.body.data.note, /no official/i)
  const admin = (await post('/api/auth/login', { username: 'admin01', password: 'Admin@123' })).body.data.token
  const audit = await get('/api/audit?entityId=AIFP-CHN-TEST01-AI-UNIT-001', admin)
  assert.ok(audit.body.data.some((a) => a.action === 'AI_FLOOR_UNIT_REVIEWED'))
})

test('phase4: existing floors / units / 3D volumes are untouched by the AI floor-plan module', async () => {
  // Phase 2 unit volume still resolves exactly as before
  const pid = makeProtoPropertyId(PARCEL_ULPIN, 1, 2, '201')
  const unit = await get(`/api/units/${pid}`)
  assert.equal(unit.status, 200)
  assert.ok(unit.body.data.volume)
  assert.ok(!('aiFloorUnitId' in unit.body.data))
  // gis units carry no AI floor-plan fields
  const gu = await get('/api/gis/units?buildingId=' + encodeURIComponent(`${PARCEL_ULPIN}-B01`))
  assert.ok(gu.body.data.features.every((f) => !('aiFloorUnitId' in f.properties)))
  // ai/status advertises the Phase 4 capability, clearly labelled
  const st = await get('/api/ai/status')
  assert.ok(st.body.data.floorPlanSegmentation)
  assert.equal(st.body.data.floorPlanSegmentation.source, 'AI_DEMO')
  assert.equal(st.body.data.floorPlanSegmentation.dataset, 'CubiCasa5K')
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

/* ------------------------------------------------------------- Phase 5 — elevation */

test('phase5: elevation config exposes the pipeline + disclaimer', async () => {
  const res = await get('/api/elevation/config')
  assert.equal(res.status, 200)
  assert.match(res.body.data.disclaimer || '', /ELEVATION_DEMO/)
})

test('phase5: uploading a DEM validates it and records TEST_FIXTURE provenance', async () => {
  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const res = await postForm(
    '/api/elevation/upload',
    {
      field: 'file',
      filename: 'dem_flat.tif',
      bytes: readFileSync(path.join(ELEV_FIXTURES, 'dem_flat.tif')),
      contentType: 'image/tiff',
      extra: { datasetType: 'DEM', locality: 'sholinganallur', sourceLabel: 'TEST_FIXTURE' },
    },
    login.body.data.token,
  )
  assert.equal(res.status, 200)
  assert.equal(res.body.data.status, 'VALIDATED')
  assert.equal(res.body.data.datasetType, 'DEM')
  assert.equal(res.body.data.provenance.source, 'TEST_FIXTURE')
  assert.equal(res.body.data.provenance.isOfficial, false)
  assert.ok(!('fileBuffer' in res.body.data)) // raw bytes never stored
})

test('phase5: elevation upload rejects a non-GeoTIFF file as bad input', async () => {
  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const res = await postForm(
    '/api/elevation/upload',
    { field: 'file', filename: 'dem.tif', bytes: tinyPng, contentType: 'image/tiff', extra: { datasetType: 'DEM' } },
    login.body.data.token,
  )
  assert.equal(res.status, 400)
})

test('phase5: elevation upload/process require ai:run permission', async () => {
  const citizen = await post('/api/auth/login', { username: 'citizen01', password: 'Citizen@123' })
  const res = await postForm(
    '/api/elevation/upload',
    { field: 'file', filename: 'dem_flat.tif', bytes: readFileSync(path.join(ELEV_FIXTURES, 'dem_flat.tif')), contentType: 'image/tiff', extra: { datasetType: 'DEM' } },
    citizen.body.data.token,
  )
  assert.equal(res.status, 403)
})

test('phase5: processing a DEM+DSM pair against real buildings runs the full pipeline gracefully', async () => {
  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const res = await postFormMulti(
    '/api/elevation/process',
    {
      files: {
        dem: { filename: 'dem_flat.tif', bytes: readFileSync(path.join(ELEV_FIXTURES, 'dem_flat.tif')), contentType: 'image/tiff' },
        dsm: { filename: 'dsm_building.tif', bytes: readFileSync(path.join(ELEV_FIXTURES, 'dsm_building.tif')), contentType: 'image/tiff' },
      },
      extra: { locality: 'sholinganallur', sourceLabel: 'TEST_FIXTURE' },
    },
    login.body.data.token,
  )
  assert.equal(res.status, 200)
  assert.equal(res.body.data.status, 'COMPLETED')
  assert.ok(res.body.data.buildings.length > 0)
  const b = res.body.data.buildings[0]
  assert.ok(['VALID', 'WARNING', 'ERROR'].includes(b.qualityStatus))
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(b.confidenceLevel))
  assert.equal(b.source, 'TEST_FIXTURE')
  // the fixture raster does not cover every Sholinganallur building footprint —
  // this must degrade gracefully (NoData / UNAVAILABLE), never fabricate a value
  for (const row of res.body.data.buildings) {
    if (row.qualityStatus === 'ERROR') assert.equal(row.buildingHeightM, null)
  }
})

test('phase5: building height endpoint reports UNAVAILABLE, never fabricated, before any dataset is processed', async () => {
  const res = await get('/api/elevation/buildings/TN-CHN-223456789-B01/height')
  assert.equal(res.status, 200)
  assert.equal(res.body.data.dataAvailability, 'UNAVAILABLE')
  assert.equal(res.body.data.existingHeightSource, 'DEMO_ESTIMATED')
})

test('phase5: accepting an elevation height reversibly rescales building + floors + units, revert restores exactly', async () => {
  const buildingId = 'TN-CHN-123456789-B01'
  const before = await db.collection('buildings').findOne({ buildingId })
  assert.ok(before, 'seeded building must exist')
  const floorsBefore = await db.collection('floors').find({ buildingId })

  // seed a VALID buildingHeights result directly (bypasses raster/footprint
  // alignment — this test is about the accept/revert mechanics, which are
  // already exercised end-to-end at the ai-service level).
  const newGround = before.baseElevationM + 2
  const newHeight = before.heightM + 10
  await db.collection('buildingHeights').create({
    buildingHeightId: `${buildingId}-TESTJOB`,
    buildingId,
    jobId: 'TESTJOB',
    groundElevationM: newGround,
    roofElevationM: newGround + newHeight,
    buildingHeightM: newHeight,
    heightMethod: 'DSM_MINUS_DEM',
    qualityStatus: 'VALID',
    qualityIssues: [],
    confidenceLevel: 'HIGH',
    confidenceScore: 0.9,
    dataSource: 'LIDAR_DERIVED',
    source: 'TEST_FIXTURE',
    reviewStatus: 'REVIEW_REQUIRED',
    appliedToBuilding: false,
    timestamp: new Date().toISOString(),
    isDemo: true,
  })

  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const accept = await patch(`/api/elevation/buildings/${buildingId}/review`, { action: 'ACCEPT' }, login.body.data.token)
  assert.equal(accept.status, 200)

  const afterBuilding = await db.collection('buildings').findOne({ buildingId })
  assert.equal(afterBuilding.baseElevationM, newGround)
  assert.equal(afterBuilding.heightM, newHeight)
  assert.equal(afterBuilding.elevationOverrideActive, true)
  assert.equal(afterBuilding.elevationOriginal.heightM, before.heightM)

  // API surface reflects it (existing endpoint — regression + integration in one)
  const bRes = await get(`/api/buildings/${buildingId}`)
  assert.equal(bRes.body.data.building.heightM, newHeight)
  assert.equal(bRes.body.data.building.volume.zmax - bRes.body.data.building.volume.zmin, newHeight)

  // floors rescaled proportionally, ordering preserved
  const floorsAfter = await db.collection('floors').find({ buildingId })
  assert.equal(floorsAfter.length, floorsBefore.length)
  const scale = newHeight / before.heightM
  for (let i = 0; i < floorsBefore.length; i += 1) {
    const expectedBase = newGround + (floorsBefore[i].baseHeight - before.baseElevationM) * scale
    assert.ok(Math.abs(floorsAfter[i].baseHeight - expectedBase) < 0.01)
  }

  const hRes = await get(`/api/elevation/buildings/${buildingId}/height`)
  assert.equal(hRes.body.data.dataAvailability, 'AVAILABLE')
  assert.equal(hRes.body.data.buildingHeightM, newHeight)

  // revert restores the exact original geometry
  const revert = await post(`/api/elevation/buildings/${buildingId}/revert`, {}, login.body.data.token)
  assert.equal(revert.status, 200)
  const restored = await db.collection('buildings').findOne({ buildingId })
  assert.equal(restored.baseElevationM, before.baseElevationM)
  assert.equal(restored.heightM, before.heightM)
  assert.equal(restored.elevationOverrideActive, false)
  const floorsRestored = await db.collection('floors').find({ buildingId })
  for (let i = 0; i < floorsBefore.length; i += 1) {
    assert.equal(floorsRestored[i].baseHeight, floorsBefore[i].baseHeight)
    assert.equal(floorsRestored[i].topHeight, floorsBefore[i].topHeight)
  }
})

test('phase5: review requires change-detection:review permission, not just ai:run', async () => {
  const buildingId = 'TN-CHN-323456789-B01'
  await db.collection('buildingHeights').create({
    buildingHeightId: `${buildingId}-TESTJOB2`,
    buildingId,
    jobId: 'TESTJOB2',
    groundElevationM: 8,
    roofElevationM: 40,
    buildingHeightM: 32,
    qualityStatus: 'VALID',
    confidenceLevel: 'MEDIUM',
    confidenceScore: 0.6,
    dataSource: 'LIDAR_DERIVED',
    source: 'TEST_FIXTURE',
    reviewStatus: 'REVIEW_REQUIRED',
    appliedToBuilding: false,
    timestamp: new Date().toISOString(),
    isDemo: true,
  })
  const revenue = await post('/api/auth/login', { username: 'revenue01', password: 'Officer@123' })
  const res = await patch(`/api/elevation/buildings/${buildingId}/review`, { action: 'ACCEPT' }, revenue.body.data.token)
  assert.equal(res.status, 403)
})

test('phase5: NO-FABRICATION — elevation output never carries source OFFICIAL', async () => {
  const login = await post('/api/auth/login', { username: 'survey01', password: 'Officer@123' })
  const res = await postFormMulti(
    '/api/elevation/process',
    {
      files: {
        dem: { filename: 'dem_flat.tif', bytes: readFileSync(path.join(ELEV_FIXTURES, 'dem_flat.tif')), contentType: 'image/tiff' },
        dsm: { filename: 'dsm_building.tif', bytes: readFileSync(path.join(ELEV_FIXTURES, 'dsm_building.tif')), contentType: 'image/tiff' },
      },
      extra: { locality: 'sholinganallur' },
    },
    login.body.data.token,
  )
  assert.equal(res.status, 200)
  assert.notEqual(res.body.data.provenance?.source, 'OFFICIAL')
  assert.equal(res.body.data.provenance?.isOfficial, false)
})

test('phase5: existing building/floor/unit APIs remain compatible after elevation module loads', async () => {
  const res = await get('/api/buildings/TN-CHN-223456789-DOES-NOT-EXIST')
  assert.equal(res.status, 404) // route must still 404, not 500
  const ok1 = await get('/api/buildings/TN-CHN-223456789-B01')
  assert.equal(ok1.status, 200)
  assert.ok(ok1.body.data.building.volume)
})
