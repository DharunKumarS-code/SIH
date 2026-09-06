// Phase 9 — Proposed 3D Property Identifier (additive). Positive cases run
// against the deterministic seeded DEMO fixtures; negative cases use a
// dedicated `locality: 'idtest'` hierarchy inserted directly and removed in
// test.after. Same harness conventions as tests/topology.test.js /
// tests/underground.test.js (node:test + raw fetch against an ephemeral server).

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { rectRing, polygon } from '../src/data/geo.js'
import { formatCanonical } from '../src/services/identifier3d/format.js'
import { parseCanonical } from '../src/services/identifier3d/parse.js'
import { validateIdentifier, getIdentifier } from '../src/services/identifier3d/index.js'

const IDT = 'idtest'
const CREATED_IDS = []
const CREATED_VERSIONS = []

let app
let server
let base
// A known-good seeded identifier (Sholinganallur B01/F02/U201, v1->v2 chain).
const SEED_CANON = '3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2'
const SEED_ULPIN = 'TN-CHN-123456789'

test.before(async () => {
  await connectStore()
  app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; resolve() })
  })
  await seedIdt()
})

test.after(async () => {
  await db.collection('parcels').deleteMany({ locality: IDT })
  await db.collection('buildings').deleteMany({ locality: IDT })
  await db.collection('floors').deleteMany({ locality: IDT })
  await db.collection('propertyUnits').deleteMany({ locality: IDT })
  await db.collection('geometryVersions').deleteMany({ entityId: { $regex: '^IDT-' } })
  await db.collection('geometryVersions').deleteMany({ geometryVersionId: { $regex: '^GVER-IDT-' } })
  await db.collection('proposed3DPropertyIdentifiers').deleteMany({ identifierId: { $regex: '^P3DI-IDT-' } })
  await db.collection('proposed3DPropertyIdentifiers').deleteMany({ locality: IDT })
  if (CREATED_IDS.length) await db.collection('proposed3DPropertyIdentifiers').deleteMany({ identifierId: { $in: CREATED_IDS } })
  for (const c of CREATED_VERSIONS) await db.collection('geometryVersions').deleteMany({ geometryVersionId: c })
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
const login = async (u, pw) => (await post('/api/auth/login', { username: u, password: pw })).body.data.token
const surveyToken = () => login('survey01', 'Officer@123')
const citizenToken = () => login('citizen01', 'Officer@123').catch(() => login('citizen01', 'Citizen@123'))

// ------------------------------------------------------------- fixtures

async function seedIdt() {
  await db.collection('parcels').create({
    ulpin: 'IDT-ULPIN-1', parcelId: 'IDT-PCL-1', locality: IDT,
    geometry: polygon(rectRing(80.30, 12.90, 300, 300)), status: 'Verified', isDemo: true,
  })
  await db.collection('buildings').create({
    buildingId: 'IDT-B01', buildingSegment: 'B01', buildingNumber: 1, ulpin: 'IDT-ULPIN-1',
    locality: IDT, geometry: polygon(rectRing(80.30, 12.90, 40, 40)), heightM: 20, baseElevationM: 0,
    constructionStatus: 'Completed', isDemo: true,
  })
  await db.collection('floors').create({
    floorId: 'IDT-B01-F01', buildingId: 'IDT-B01', ulpin: 'IDT-ULPIN-1', locality: IDT,
    floorNumber: 1, floorSegment: 'F01', label: 'Floor 01', baseHeight: 0, topHeight: 3.2, isDemo: true,
  })
  await db.collection('propertyUnits').create({
    propertyId: 'IDT-ULPIN-1-B01-F01-U101', unitId: 'U101', apartmentNumber: '101',
    buildingId: 'IDT-B01', buildingSegment: 'B01', buildingNumber: 1, floorId: 'IDT-B01-F01',
    floorNumber: 1, ulpin: 'IDT-ULPIN-1', locality: IDT,
    geometry: polygon(rectRing(80.30, 12.90, 10, 10)), baseHeight: 0, topHeight: 3.2,
    usage: 'Residential', status: 'Verified', isDemo: true,
  })
  // a SECOND unit with no identifier / no version yet — used by the positive
  // "create + resolve is VALID" control.
  await db.collection('propertyUnits').create({
    propertyId: 'IDT-ULPIN-1-B01-F01-U102', unitId: 'U102', apartmentNumber: '102',
    buildingId: 'IDT-B01', buildingSegment: 'B01', buildingNumber: 1, floorId: 'IDT-B01-F01',
    floorNumber: 1, ulpin: 'IDT-ULPIN-1', locality: IDT,
    geometry: polygon(rectRing(80.30005, 12.90, 10, 10)), baseHeight: 0, topHeight: 3.2,
    usage: 'Residential', status: 'Verified', isDemo: true,
  })
  // a baseline geometry version for this unit's volume (V0101)
  await db.collection('geometryVersions').create({
    geometryVersionId: 'GVER-IDT-0001', entityType: 'VOLUME', entityId: 'IDT-ULPIN-1-B01-F01-U101',
    geometryVersion: 'v1', previousVersion: null, status: 'ACTIVE', source: 'DEMO',
    reason: 'baseline', provenance: 'test', verificationStatus: 'DEMO', isOfficial: false,
    geometryRef: { kind: 'VOLUME', id: 'V0101' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  // an identifier record pointing at the idtest unit — used by the MUTATING
  // version tests so they never touch the read-only seeded fixtures.
  await db.collection('proposed3DPropertyIdentifiers').create({
    identifierId: 'P3DI-IDT-0001',
    canonicalIdentifier: '3DPR:IDT-ULPIN-1:B01:F01:U101:V0101:v1',
    label: 'Proposed 3D Property Identifier',
    officialULPIN: 'IDT-ULPIN-1', officialULPINStatus: 'DEMO_NOT_OFFICIAL', officialULPINVerified: false,
    internalParcelRef: null,
    parcelId: 'IDT-PCL-1', buildingId: 'IDT-B01', buildingSegment: 'B01',
    floorId: 'IDT-B01-F01', floorSegment: 'F01', unitId: 'U101', propertyId: 'IDT-ULPIN-1-B01-F01-U101',
    unitSegment: 'U101', volumeId: 'V0101', geometryVersion: 'v1',
    status: 'PROPOSED', source: 'DEMO', verificationStatus: 'DEMO', isOfficial: false,
    legalStatus: 'NOT_ESTABLISHED', ownershipStatus: 'NOT_PROVIDED', rightsStatus: 'NOT_ESTABLISHED', encumbranceStatus: 'NOT_PROVIDED',
    geometryStatus: 'VALID', locality: IDT, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}
const IDT_ID = 'P3DI-IDT-0001'

// --------------------------------------------------------------- parser

test('id3d: parser round-trips a valid canonical identifier and is idempotent', () => {
  const r = parseCanonical('3dpr:TN-CHN-123456789:b01:f02:u201:v0201:2')
  assert.equal(r.ok, true)
  assert.equal(r.canonical, '3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2') // uppercased, version normalised
  assert.equal(r.parts.buildingNumber, 1)
  assert.equal(r.parts.floorNumber, 2)
  assert.equal(r.parts.apartmentNumber, '201')
  // format(parse(s)) === canonical
  assert.equal(formatCanonical({ ...r.parts, officialULPIN: r.parts.officialULPIN }), r.canonical)
})

test('id3d: parser rejects malformed identifiers with explicit errors (no silent repair)', () => {
  assert.equal(parseCanonical('XYZ:a:b').ok, false)
  assert.equal(parseCanonical('3DPR:TN-CHN-123456789:B1:F02:U201:V0201:v1').ok, false) // B1 not B01
  assert.equal(parseCanonical('3DPR:TN-CHN-123456789:B01:F02:U201:V0201').ok, false) // 6 tokens
  assert.equal(parseCanonical('3DPR:TN-CHN-123456789:B01:F02:U201:V0201:x9').ok, false) // bad version
  assert.match(parseCanonical('WRONG:TN-CHN-123456789:B01:F02:U201:V0201:v1').errors.join(' '), /scheme prefix/)
})

test('id3d: parser accepts the NA sentinel and an internal parcel reference as the parcel key', () => {
  const na = parseCanonical('3DPR:NA:B01:F02:U201:V0201:v1')
  assert.equal(na.ok, true)
  assert.equal(na.parts.officialULPIN, null)
  assert.equal(na.parts.parcelKeyIsNA, true)
  const internal = parseCanonical('3DPR:PCL-CHN-SHLN-0001:B01:F02:U201:V0201:v1')
  assert.equal(internal.ok, true)
  assert.equal(internal.parts.officialULPIN, 'PCL-CHN-SHLN-0001')
})

// -------------------------------------------------------------- config

test('id3d: config documents the canonical format and states it is NOT official / NOT a government standard', async () => {
  const res = await get('/api/3d-identifiers/config')
  assert.equal(res.status, 200)
  assert.equal(res.body.data.isOfficial, false)
  assert.equal(res.body.data.status, 'PROPOSED')
  assert.match(res.body.data.canonicalFormat, /^3DPR:/)
  assert.match(res.body.data.disclaimer, /NOT an officially approved Government of India or Tamil Nadu 3D ULPIN/i)
  assert.match(res.body.data.standardizationNote, /No government body has approved a 3D/i)
})

// ------------------------------------------------- seeded positive cases

test('id3d: a seeded identifier resolves VALID with the full parcel->volume hierarchy and a focus ref', async () => {
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(SEED_CANON)}`)
  assert.equal(res.status, 200)
  const d = res.body.data
  assert.equal(d.canonicalIdentifier, SEED_CANON)
  assert.equal(d.geometryStatus, 'VALID')
  assert.equal(d.validation.overallStatus, 'VALID')
  for (const k of ['parcel', 'building', 'floor', 'unit', 'volume', 'geometryVersion']) {
    assert.equal(d.hierarchy.found[k], true, `hierarchy.${k} must resolve`)
  }
  assert.equal(d.hierarchy.volumeIdMatches, true)
  assert.equal(d.focusRef.kind, 'unit')
  assert.equal(d.focusRef.propertyId, 'TN-CHN-123456789-B01-F02-U201')
})

test('id3d: the Official ULPIN stays SEPARATE and is never marked official by Phase 9', async () => {
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(SEED_CANON)}`)
  const d = res.body.data
  assert.equal(d.isOfficial, false)
  assert.equal(d.status, 'PROPOSED')
  assert.equal(d.officialULPIN, SEED_ULPIN)
  assert.equal(d.officialULPINStatus, 'DEMO_NOT_OFFICIAL') // the parcel's own status, unchanged
  assert.equal(d.officialULPINVerified, false)
  assert.match(d.officialULPINDisplay, /DEMO_NOT_OFFICIAL/)
})

test('id3d: a seeded record with no Official ULPIN shows NOT AVAILABLE (never a fabricated id) and REVIEW_REQUIRED', async () => {
  const [rec] = await db.collection('proposed3DPropertyIdentifiers').find({ officialULPIN: null, locality: 'sholinganallur' })
  assert.ok(rec, 'expected a seeded null-ULPIN identifier')
  assert.equal(rec.internalParcelRef, 'PCL-CHN-SHLN-0001')
  const d = await getIdentifier(rec.canonicalIdentifier)
  assert.equal(d.officialULPIN, null)
  assert.equal(d.officialULPINDisplay, 'NOT AVAILABLE')
  assert.equal(d.officialULPINStatus, 'NOT_AVAILABLE')
  assert.equal(d.validation.overallStatus, 'REVIEW_REQUIRED')
  assert.ok(d.validation.findings.some((f) => f.ruleId === 'ID3D_MISSING_OFFICIAL_ULPIN'))
  // the hierarchy still fully resolves via the internal parcel reference
  assert.equal(d.hierarchy.found.unit, true)
})

test('id3d: rights / restrictions / encumbrances are conceptual placeholders only — ownership is never inferred', async () => {
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(SEED_CANON)}`)
  const d = res.body.data
  assert.equal(d.legalStatus, 'NOT_ESTABLISHED')
  assert.equal(d.ownershipStatus, 'NOT_PROVIDED')
  assert.equal(d.rightsStatus, 'NOT_ESTABLISHED')
  assert.equal(d.encumbranceStatus, 'NOT_PROVIDED')
  assert.deepEqual(d.conceptualVolumetricRights.rights, [])
  assert.deepEqual(d.conceptualVolumetricRights.restrictions, [])
  assert.deepEqual(d.conceptualVolumetricRights.encumbrances, [])
  assert.match(d.conceptualVolumetricRights.note, /No statement of legal rights/i)
})

// -------------------------------------------------------- version history

test('id3d: geometry version history is exposed, keeps SUPERSEDED versions, and has exactly one ACTIVE', async () => {
  const id = (await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: SEED_CANON })).identifierId
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(id)}/versions`)
  assert.equal(res.status, 200)
  const versions = res.body.data.versions
  assert.ok(versions.length >= 2)
  assert.ok(versions.some((v) => v.geometryVersion === 'v1' && v.status === 'SUPERSEDED'), 'v1 must remain, as SUPERSEDED')
  assert.ok(versions.some((v) => v.geometryVersion === 'v2' && v.status === 'ACTIVE'))
  assert.equal(versions.filter((v) => v.status === 'ACTIVE').length, 1)
  assert.equal(res.body.data.activeVersion, 'v2')
})

test('id3d: creating a new geometry version supersedes the prior ACTIVE in place (immutability, single ACTIVE)', async () => {
  const officer = await surveyToken()
  const before = await db.collection('geometryVersions').find({ entityId: 'IDT-ULPIN-1-B01-F01-U101' })
  const res = await post(`/api/3d-identifiers/${encodeURIComponent(IDT_ID)}/versions`, { source: 'UPLOADED_SURVEY', reason: 'test supersede' }, officer)
  assert.equal(res.status, 200)
  CREATED_VERSIONS.push(res.body.data.geometryVersionId)
  assert.equal(res.body.data.geometryVersion, `v${before.length + 1}`)
  assert.equal(res.body.data.status, 'ACTIVE')
  assert.equal(res.body.data.previousVersion, `v${before.length}`)
  const after = await db.collection('geometryVersions').find({ entityId: 'IDT-ULPIN-1-B01-F01-U101' })
  assert.equal(after.filter((v) => v.status === 'ACTIVE').length, 1, 'still exactly one ACTIVE')
  const oldActive = after.find((v) => v.geometryVersion === `v${before.length}`)
  assert.equal(oldActive.status, 'SUPERSEDED') // the previous ACTIVE was superseded, not deleted
  assert.equal(oldActive.supersededBy, res.body.data.geometryVersion)
})

test('id3d: an illegal version status transition is rejected', async () => {
  const officer = await surveyToken()
  // v1 on the idtest unit is SUPERSEDED by the test above -> SUPERSEDED -> ACTIVE is not allowed
  const res = await patch(`/api/3d-identifiers/${encodeURIComponent(IDT_ID)}/versions/review`, { geometryVersion: 'v1', toStatus: 'ACTIVE' }, officer)
  assert.equal(res.status, 400)
  assert.match(res.body.error.message, /Illegal transition/i)
})

// --------------------------------------------------------- validation

test('id3d: validate rejects a broken hierarchy (missing floor/unit) with explicit findings', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers/validate', { canonicalIdentifier: '3DPR:TN-CHN-123456789:B01:F97:U999:V0201:v1', source: 'DEMO' }, officer)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.overallStatus, 'ERROR')
  const rules = res.body.data.findings.map((f) => f.ruleId)
  assert.ok(rules.includes('ID3D_FLOOR_NOT_FOUND'))
  assert.ok(rules.includes('ID3D_UNIT_NOT_FOUND'))
})

test('id3d: validate flags a volume-id mismatch and never marks such an identifier valid', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers/validate', { canonicalIdentifier: '3DPR:TN-CHN-123456789:B01:F02:U201:V9999:v1', source: 'DEMO' }, officer)
  assert.equal(res.body.data.overallStatus, 'ERROR')
  assert.ok(res.body.data.findings.some((f) => f.ruleId === 'ID3D_VOLUME_ID_MISMATCH'))
  assert.equal(res.body.data.geometryStatus, 'INVALID_GEOMETRY_REFERENCE')
})

test('id3d: validate flags a fabricated-Official-ULPIN attempt (the identifier can never be an Official ULPIN)', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers/validate', { canonicalIdentifier: SEED_CANON, source: 'DEMO', claimOfficial: true }, officer)
  assert.ok(res.body.data.findings.some((f) => f.ruleId === 'ID3D_FABRICATED_OFFICIAL_ULPIN'))
})

test('id3d: validate flags missing provenance when no source is supplied', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers/validate', { canonicalIdentifier: '3DPR:IDT-ULPIN-1:B01:F01:U101:V0101:v1' }, officer)
  assert.ok(res.body.data.findings.some((f) => f.ruleId === 'ID3D_MISSING_PROVENANCE'))
})

test('id3d: create + resolve a fresh idtest identifier is VALID and auto-creates a v1 baseline geometry version', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers', { propertyId: 'IDT-ULPIN-1-B01-F01-U102', officialULPIN: 'IDT-ULPIN-1', geometryVersion: 'v1', source: 'DEMO' }, officer)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  CREATED_IDS.push(res.body.data.identifierId)
  assert.equal(res.body.data.validation.overallStatus, 'VALID')
  assert.equal(res.body.data.geometryStatus, 'VALID')
  assert.equal(res.body.data.isOfficial, false)
  assert.equal(res.body.data.status, 'PROPOSED')
  // the v1 baseline version now exists for that unit
  const versions = await db.collection('geometryVersions').find({ entityId: 'IDT-ULPIN-1-B01-F01-U102' })
  assert.ok(versions.some((v) => v.geometryVersion === 'v1' && v.status === 'ACTIVE'))
})

// ------------------------------------------------------------- create

test('id3d: create from a propertyId yields a deterministic canonical identifier; a repeat is a reported collision', async () => {
  const officer = await surveyToken()
  // B03/F01/U101 is NOT one of the seeded demo identifiers
  const c1 = await post('/api/3d-identifiers', { propertyId: 'TN-CHN-123456789-B03-F01-U101', geometryVersion: 'v1', source: 'DEMO' }, officer)
  assert.equal(c1.status, 200)
  CREATED_IDS.push(c1.body.data.identifierId)
  const canon = c1.body.data.canonicalIdentifier
  assert.match(canon, /^3DPR:TN-CHN-123456789:B03:F01:U101:V\d{2,4}:v1$/)
  assert.equal(c1.body.data.isOfficial, false)
  assert.equal(c1.body.data.status, 'PROPOSED')

  // identical hierarchy+version -> same canonical -> reported duplicate, not silently renamed
  const c2 = await post('/api/3d-identifiers', { propertyId: 'TN-CHN-123456789-B03-F01-U101', geometryVersion: 'v1', source: 'DEMO' }, officer)
  assert.equal(c2.status, 400)
  assert.match(JSON.stringify(c2.body), /ID3D_DUPLICATE_IDENTIFIER/)
})

test('id3d: create refuses a broken hierarchy (HTTP 409-class) and returns the findings', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers', { canonicalIdentifier: '3DPR:TN-CHN-123456789:B01:F02:U201:V9999:v1', source: 'DEMO' }, officer)
  assert.ok(res.status >= 400 && res.status < 500)
  assert.match(JSON.stringify(res.body), /ID3D_VOLUME_ID_MISMATCH/)
})

test('id3d: create with a malformed identifier is a 400', async () => {
  const officer = await surveyToken()
  const res = await post('/api/3d-identifiers', { canonicalIdentifier: '3DPR:BAD' }, officer)
  assert.equal(res.status, 400)
})

// -------------------------------------------------------------- RBAC

test('id3d: create / validate / versions require their permissions — a citizen is forbidden', async () => {
  const citizen = await citizenToken()
  assert.equal((await post('/api/3d-identifiers', { propertyId: 'TN-CHN-123456789-B01-F01-U101' }, citizen)).status, 403)
  assert.equal((await post('/api/3d-identifiers/validate', { canonicalIdentifier: SEED_CANON }, citizen)).status, 403)
  const id = (await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: SEED_CANON })).identifierId
  assert.equal((await post(`/api/3d-identifiers/${encodeURIComponent(id)}/versions`, { source: 'DEMO' }, citizen)).status, 403)
  assert.equal((await post(`/api/3d-identifiers/${encodeURIComponent(id)}/revalidate`, {}, citizen)).status, 403)
})

test('id3d: read endpoints are open (optionalAuth) and list/search work', async () => {
  const list = await get('/api/3d-identifiers?locality=sholinganallur')
  assert.equal(list.status, 200)
  assert.ok(list.body.data.length >= 3)
  const s = await get(`/api/3d-identifiers/search?q=${encodeURIComponent('3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2')}`)
  assert.equal(s.status, 200)
  assert.ok(s.body.data.results.some((r) => r.canonicalIdentifier === SEED_CANON))
})

// ----------------------------------------------- lookup by Official ULPIN

test('id3d: GET /ulpins/:ulpin/3d-identifiers lists proposed refs and states they do not replace the Official ULPIN', async () => {
  const res = await get(`/api/ulpins/${SEED_ULPIN}/3d-identifiers`)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.officialULPIN, SEED_ULPIN)
  assert.ok(res.body.data.count >= 1)
  assert.ok(res.body.data.proposed3DIdentifiers.some((r) => r.canonicalIdentifier === SEED_CANON))
  assert.match(res.body.data.note, /replace or upgrade the Official ULPIN/i)
})

// --------------------------------------------------- geometry / hierarchy

test('id3d: /geometry references EXISTING geometry (parcel/building/unit/volume) — never a second copy', async () => {
  const id = (await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: SEED_CANON })).identifierId
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(id)}/geometry`)
  assert.equal(res.status, 200)
  assert.ok(res.body.data.geometry.parcel && res.body.data.geometry.parcel.type)
  assert.ok(res.body.data.geometry.unit && res.body.data.geometry.unit.type)
  assert.ok(res.body.data.geometry.volume && res.body.data.geometry.volume.volumeId)
  assert.equal(res.body.data.volumeIdMatches, true)
})

test('id3d: /hierarchy exposes Phase-7 geometry health and Phase-8 spatial relations (relationship only)', async () => {
  const id = (await db.collection('proposed3DPropertyIdentifiers').findOne({ canonicalIdentifier: SEED_CANON })).identifierId
  const res = await get(`/api/3d-identifiers/${encodeURIComponent(id)}/hierarchy`)
  assert.equal(res.status, 200)
  assert.ok(['VALID', 'WARNING', 'ERROR', 'REVIEW_REQUIRED', 'INVALID_GEOMETRY_REFERENCE'].includes(res.body.data.geometryStatus))
  assert.ok(Array.isArray(res.body.data.relatedUndergroundInfrastructure))
})

// ------------------------------------------------------ global search

test('id3d: the global /search resolves a 3DPR string to a focusable identifier result', async () => {
  const res = await get(`/api/search?q=${encodeURIComponent(SEED_CANON)}`)
  assert.equal(res.status, 200)
  const hit = res.body.data.results.find((r) => r.kind === 'identifier' && r.title === SEED_CANON)
  assert.ok(hit)
  assert.equal(hit.ref.propertyId, 'TN-CHN-123456789-B01-F02-U201')
})

// ------------------------------------------------------------- errors

test('id3d: an unknown identifier 404s cleanly', async () => {
  assert.equal((await get('/api/3d-identifiers/P3DI-NOPE')).status, 404)
  assert.equal((await get('/api/3d-identifiers/3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v9')).status, 404)
})

test('id3d: existing parcel / unit APIs remain intact after the identifier module loads', async () => {
  assert.equal((await get('/api/parcels')).status, 200)
  assert.equal((await get('/api/units/TN-CHN-123456789-B01-F02-U201')).status, 200)
})

// --------------------------------------------------- pure-function units

test('id3d: validateIdentifier is deterministic and never mutates any stored document', async () => {
  const before = await db.collection('propertyUnits').findOne({ propertyId: 'TN-CHN-123456789-B01-F02-U201' })
  const a = await validateIdentifier({ canonicalIdentifier: SEED_CANON, officialULPIN: SEED_ULPIN, source: 'DEMO', identifierId: 'x' })
  const b = await validateIdentifier({ canonicalIdentifier: SEED_CANON, officialULPIN: SEED_ULPIN, source: 'DEMO', identifierId: 'x' })
  assert.equal(a.overallStatus, b.overallStatus)
  assert.equal(a.canonical, b.canonical)
  const after = await db.collection('propertyUnits').findOne({ propertyId: 'TN-CHN-123456789-B01-F02-U201' })
  assert.deepEqual(before.geometry, after.geometry)
})
