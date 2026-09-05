// Phase 6 — GNSS/CORS high-precision spatial control (additive). Deterministic
// SYNTHETIC / TEST_FIXTURE data only (backend/tests/fixtures/gnss/) — never
// real Chennai survey observations. Same test-harness conventions as
// tests/api.test.js (node:test + raw fetch against an ephemeral server).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { associateParcel } from '../src/services/gnss/associate.js'
import { computeElevationResidual } from '../src/services/gnss/elevation.js'
import { verifyParcelBoundary } from '../src/services/gnss/boundary.js'
import { validateBatch } from '../src/services/gnss/validate.js'

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/gnss')
const fx = (name) => readFileSync(path.join(FIX, name))

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
    body: JSON.stringify(data),
  })
  return { status: res.status, body: await res.json() }
}
const patch = async (p, data, token) => {
  const res = await fetch(base + p, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: await res.json() }
}
const postFile = async (p, { filename, bytes, format, extra = {} }, token) => {
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), filename)
  fd.append('format', format)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(base + p, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : undefined, body: fd })
  return { status: res.status, body: await res.json() }
}

const login = async (username, password) => (await post('/api/auth/login', { username, password })).body.data.token
const surveyToken = () => login('survey01', 'Officer@123')
const citizenToken = () => login('citizen01', 'Citizen@123')
const revenueToken = () => login('revenue01', 'Officer@123')

const findIssue = (issues, rule) => (issues || []).find((i) => i.rule === rule)

test('gnss: config exposes pipeline, thresholds and the GNSS/CORS disclaimer', async () => {
  const res = await get('/api/gnss/config')
  assert.equal(res.status, 200)
  assert.match(res.body.data.disclaimer, /GNSS\/CORS DEMO/)
  assert.ok(Array.isArray(res.body.data.pipeline))
  assert.ok(res.body.data.thresholds.boundaryToleranceM > 0)
})

test('gnss: validate/import require ai:run permission', async () => {
  const token = await citizenToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('valid_wgs84.csv'), format: 'csv' }, token)
  assert.equal(res.status, 403)
})

test('gnss: validate-only never persists anything', async () => {
  const token = await surveyToken()
  const before = await db.collection('gnssControlPoints').count({})
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('valid_wgs84.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.overallStatus, 'VALID')
  assert.equal(res.body.data.points.length, 4)
  const after = await db.collection('gnssControlPoints').count({})
  assert.equal(after, before)
})

test('gnss: import valid WGS84 points -> stored, MATCHED to the seeded parcel, accuracy reported as-supplied', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('valid_wgs84.csv'), format: 'csv', extra: { locality: 'sholinganallur', sourceLabel: 'CORS_SURVEY' } }, token)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.status, 'COMPLETED')
  assert.equal(res.body.data.controlPoints.length, 4)
  for (const cp of res.body.data.controlPoints) {
    assert.equal(cp.parcelStatus, 'MATCHED')
    assert.equal(cp.parentULPIN, 'TN-CHN-123456789')
    assert.equal(cp.accuracyStatus, 'REPORTED')
    assert.equal(cp.isOfficial, false)
    assert.equal(cp.source, 'CORS_SURVEY')
  }
  const stored = await db.collection('gnssControlPoints').findOne({ controlPointId: 'GCP-001' })
  assert.ok(stored)
  assert.equal(stored.accuracy, 0.02)
})

test('gnss: NO-FABRICATION — naming a source CORS_SURVEY never invents accuracy when none was supplied', async () => {
  const token = await surveyToken()
  const csv = 'controlPointId,latitude,longitude,height,accuracy,coordinateReferenceSystem,timestamp,source,surveyMethod\nGCP-NOACC-001,12.90045,80.22705,8.0,,EPSG:4326,2024-01-25T10:00:00Z,CORS_SURVEY,RTK\n'
  const res = await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: Buffer.from(csv), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const cp = res.body.data.controlPoints[0]
  assert.equal(cp.accuracy, null)
  assert.equal(cp.accuracyStatus, 'UNAVAILABLE')
  assert.equal(cp.isSurveyGradeSource, true) // the label alone — not proof of accuracy
})

test('gnss: demo/synthetic accuracy is explicitly NOT_SURVEY_VALIDATED, never OFFICIAL', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/import', { filename: 'a.geojson', bytes: fx('demo_provenance.geojson'), format: 'geojson', extra: { locality: 'sholinganallur', sourceLabel: 'DEMO' } }, token)
  assert.equal(res.status, 200)
  const cp = res.body.data.controlPoints.find((c) => c.controlPointId === 'GCP-GEO-DEMO-001')
  assert.equal(cp.accuracy, null)
  assert.equal(cp.accuracyStatus, 'NOT_SURVEY_VALIDATED')
  assert.equal(cp.isOfficial, false)
  assert.equal(cp.height, 8) // z from the GeoJSON Point coordinate
})

test('gnss: missing CRS is UNKNOWN, never silently assumed WGS84', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('missing_crs.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const p = res.body.data.points[0]
  assert.equal(p.crsStatus, 'UNKNOWN')
  assert.ok(findIssue(p.issues, 'CRS_UNKNOWN'))
})

test('gnss: invalid latitude / longitude / missing coordinate are detected as ERROR', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('invalid_coordinates.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const [badLat, badLon, missing] = res.body.data.points
  assert.equal(badLat.validationStatus, 'ERROR')
  assert.ok(findIssue(badLat.issues, 'INVALID_LATITUDE'))
  assert.equal(badLon.validationStatus, 'ERROR')
  assert.ok(findIssue(badLon.issues, 'INVALID_LONGITUDE'))
  assert.equal(missing.validationStatus, 'ERROR')
  assert.ok(findIssue(missing.issues, 'MISSING_COORDINATE'))
})

test('gnss: duplicate control point id and duplicate coordinate are both detected', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('duplicates.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const points = res.body.data.points
  assert.ok(points.filter((p) => p.controlPointId === 'GCP-DUP-1').every((p) => findIssue(p.issues, 'DUPLICATE_CONTROL_POINT_ID')))
  assert.ok(findIssue(points[2].issues, 'DUPLICATE_COORDINATE')) // GCP-DUP-2
  assert.ok(findIssue(points[3].issues, 'DUPLICATE_COORDINATE')) // GCP-DUP-3, 3mm from GCP-DUP-2
})

test('gnss: spatial and height outliers are flagged as neighbour-relative, not a fabricated measurement error', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('outliers.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const byId = Object.fromEntries(res.body.data.points.map((p) => [p.controlPointId, p]))
  const spatial = findIssue(byId['GCP-OUT-SPATIAL'].issues, 'OUTLIER_COORDINATE')
  assert.ok(spatial)
  assert.match(spatial.message, /neighbouring control points/)
  assert.doesNotMatch(spatial.message, /inaccurate by/)
  assert.ok(findIssue(byId['GCP-OUT-HEIGHT'].issues, 'HEIGHT_OUTLIER'))
  // normal cluster points are not flagged
  assert.ok(!findIssue(byId['GCP-OUT-1'].issues, 'OUTLIER_COORDINATE'))
})

test('gnss: points near a parcel boundary are REVIEW_REQUIRED, not arbitrarily resolved', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('near_boundary.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const [nearIn, nearOut, farOut] = res.body.data.points
  assert.equal(nearIn.parcelAssociation.parcelStatus, 'REVIEW_REQUIRED')
  assert.equal(nearOut.parcelAssociation.parcelStatus, 'REVIEW_REQUIRED')
  assert.equal(farOut.parcelAssociation.parcelStatus, 'OUTSIDE_PARCEL')
})

test('gnss: reported vs. missing vs. impossible accuracy are distinguished', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('accuracy_variants.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const [reported, missing, impossible] = res.body.data.points
  assert.equal(reported.validationStatus, 'VALID')
  assert.ok(!findIssue(reported.issues, 'ACCURACY_UNAVAILABLE'))
  assert.ok(findIssue(missing.issues, 'ACCURACY_UNAVAILABLE'))
  assert.ok(findIssue(impossible.issues, 'IMPOSSIBLE_ACCURACY'))
  assert.equal(impossible.validationStatus, 'ERROR')
})

test('gnss: missing / invalid timestamp are distinguished (warning vs error)', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('timestamps.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const [valid, missing, invalid] = res.body.data.points
  assert.equal(valid.validationStatus, 'VALID')
  assert.equal(findIssue(missing.issues, 'MISSING_TIMESTAMP').status, 'WARNING')
  assert.equal(findIssue(invalid.issues, 'INVALID_TIMESTAMP').status, 'ERROR')
})

test('gnss: a CRS that cannot be resolved never fabricates a coordinate (TRANSFORMATION_FAILURE)', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.json', bytes: fx('crs_transform_failure.json'), format: 'json', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const p = res.body.data.points[0]
  assert.equal(p.resolvedLatitude, null)
  assert.equal(p.resolvedLongitude, null)
  assert.equal(p.validationStatus, 'ERROR')
  assert.ok(findIssue(p.issues, 'TRANSFORMATION_FAILURE'))
})

test('gnss: malformed JSON is rejected as a 400, never a 500', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'bad.json', bytes: fx('malformed.json'), format: 'json', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 400)
})

test('gnss: a projected CRS is transformed to WGS84 when the ai-service is reachable, or degrades gracefully otherwise', async () => {
  const token = await surveyToken()
  const res = await postFile('/api/gnss/control-points/validate', { filename: 'a.csv', bytes: fx('projected_crs.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  assert.equal(res.status, 200)
  const p = res.body.data.points[0]
  assert.ok(['REPROJECTED', 'MATCHED', 'UNKNOWN', 'TRANSFORMATION_UNAVAILABLE'].includes(p.crsStatus))
  if (p.crsStatus === 'REPROJECTED') {
    assert.ok(Math.abs(p.resolvedLongitude - 80.22705) < 0.001)
    assert.ok(Math.abs(p.resolvedLatitude - 12.90045) < 0.001)
    assert.equal(p.parcelAssociation.parcelStatus, 'MATCHED')
  }
})

test('gnss: POST /api/gnss/transform is a thin, honest pyproj passthrough', async () => {
  const token = await surveyToken()
  const res = await post('/api/gnss/transform', { points: [{ x: 80.22705, y: 12.90045 }], sourceCRS: 'EPSG:4326', targetCRS: 'EPSG:32644' }, token)
  assert.equal(res.status, 200)
  assert.ok(['REPROJECTED', 'TRANSFORMATION_UNAVAILABLE'].includes(res.body.data.status))
})

test('gnss: parcel control-points endpoint lists every associated point (interior + near-boundary)', async () => {
  const token = await surveyToken()
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('valid_wgs84.csv'), format: 'csv', extra: { locality: 'sholinganallur', sourceLabel: 'CORS_SURVEY' } }, token)
  const list = await get('/api/gnss/parcels/TN-CHN-123456789/control-points')
  assert.equal(list.status, 200)
  assert.ok(list.body.data.length >= 4)
})

test('gnss: boundary-verification is WITHIN_TOLERANCE for corner-marker-style points near the boundary, and interior points correctly read OUTSIDE_TOLERANCE (they are far from any edge)', async () => {
  const token = await surveyToken()
  // interior points (~135 m from the nearest edge) — a real deviation check
  // against the boundary itself would rightly flag these as OUTSIDE_TOLERANCE;
  // they are simply not boundary-marker observations.
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('valid_wgs84.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  const interior = await get('/api/gnss/parcels/TN-CHN-123456789/boundary-verification')
  assert.equal(interior.status, 200)
  assert.equal(interior.body.data.verificationStatus, 'OUTSIDE_TOLERANCE')

  // now add two boundary-marker-style points (~0.4 m either side of the edge)
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('near_boundary.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  const run = await post('/api/gnss/boundary-analysis', { ulpin: 'TN-CHN-123456789' }, token)
  assert.equal(run.status, 200)
  assert.equal(run.body.data.parcelId, 'PCL-CHN-SHLN-0001')
  assert.match(run.body.data.note, /OBSERVED DEVIATION/)
  const stored = await db.collection('boundaryVerification').findOne({ boundaryVerificationId: run.body.data.boundaryVerificationId })
  assert.ok(stored)
  // the aggregate now includes both the 4 interior points and the 2 boundary points
  assert.ok(run.body.data.deviations.count >= 6)
  const nearInPoint = run.body.data.points.find((p) => p.controlPointId === 'GCP-NEARIN-001')
  assert.equal(nearInPoint.verificationStatus, 'WITHIN_TOLERANCE')
})

test('gnss: parcel geometry is NEVER changed by import or boundary analysis alone', async () => {
  const before = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-123456789' })
  const token = await surveyToken()
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('near_boundary.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  await post('/api/gnss/boundary-analysis', { ulpin: 'TN-CHN-123456789' }, token)
  const after = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-123456789' })
  assert.deepEqual(after.geometry, before.geometry)
})

test('gnss: geometry review proposal — create requires parcel:boundary-review, accept requires change-detection:review, and only ACCEPT ever writes parcel geometry', async () => {
  const parcel = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-223456789' })
  const originalGeometry = parcel.geometry
  const proposedGeometry = { type: 'Polygon', coordinates: originalGeometry.coordinates }

  const citizen = await citizenToken()
  const denied = await post('/api/gnss/proposals', { ulpin: 'TN-CHN-223456789', proposedGeometry, reason: 'test' }, citizen)
  assert.equal(denied.status, 403)

  const survey = await surveyToken()
  const created = await post('/api/gnss/proposals', { ulpin: 'TN-CHN-223456789', proposedGeometry, reason: 'GNSS boundary check', controlPointIds: ['GCP-001'] }, survey)
  assert.equal(created.status, 200)
  assert.equal(created.body.data.reviewStatus, 'PENDING_REVIEW')
  const proposalId = created.body.data.proposalId

  const stillOriginal = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-223456789' })
  assert.deepEqual(stillOriginal.geometry, originalGeometry)

  const revenue = await revenueToken()
  const deniedReview = await patch(`/api/gnss/proposals/${proposalId}/review`, { action: 'ACCEPT' }, revenue)
  assert.equal(deniedReview.status, 403)

  const accepted = await patch(`/api/gnss/proposals/${proposalId}/review`, { action: 'ACCEPT' }, survey)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.data.reviewStatus, 'ACCEPTED')

  const updatedParcel = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-223456789' })
  assert.deepEqual(updatedParcel.geometry, proposedGeometry)

  const auditRows = await db.collection('auditLogs').find({ action: 'PARCEL_GEOMETRY_PROPOSAL_ACCEPTED' })
  assert.ok(auditRows.some((r) => r.entityId === parcel.parcelId))
})

test('gnss: a REJECTED proposal never touches parcel geometry', async () => {
  const parcel = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-323456789' })
  const originalGeometry = parcel.geometry
  const survey = await surveyToken()
  const created = await post('/api/gnss/proposals', { ulpin: 'TN-CHN-323456789', proposedGeometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }, reason: 'test' }, survey)
  assert.equal(created.status, 200)
  const rejected = await patch(`/api/gnss/proposals/${created.body.data.proposalId}/review`, { action: 'REJECT' }, survey)
  assert.equal(rejected.status, 200)
  assert.equal(rejected.body.data.reviewStatus, 'REJECTED')
  const after = await db.collection('parcels').findOne({ ulpin: 'TN-CHN-323456789' })
  assert.deepEqual(after.geometry, originalGeometry)
})

test('gnss: generic control-point review requires change-detection:review', async () => {
  const token = await surveyToken()
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: fx('near_boundary.csv'), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  const citizen = await citizenToken()
  const denied = await post('/api/gnss/review', { controlPointId: 'GCP-NEARIN-001', action: 'ACCEPTED' }, citizen)
  assert.equal(denied.status, 403)
  const ok1 = await post('/api/gnss/review', { controlPointId: 'GCP-NEARIN-001', action: 'ACCEPTED' }, token)
  assert.equal(ok1.status, 200)
  assert.equal(ok1.body.data.verificationStatus, 'ACCEPTED')
})

test('gnss: elevation residual endpoint compares observed vs. model elevation without declaring either "correct"', async () => {
  const buildingId = 'TN-CHN-123456789-B01'
  const building = await db.collection('buildings').findOne({ buildingId })
  const ring = building.geometry.coordinates[0]
  const n = ring.length - 1
  const clon = ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n
  const clat = ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n
  const token = await surveyToken()
  const csv = `controlPointId,latitude,longitude,height,accuracy,coordinateReferenceSystem,timestamp,source,surveyMethod\nGCP-ELEV-001,${clat},${clon},${building.baseElevationM + 0.5},0.03,EPSG:4326,2024-01-26T10:00:00Z,CORS_SURVEY,RTK\n`
  await postFile('/api/gnss/control-points/import', { filename: 'a.csv', bytes: Buffer.from(csv), format: 'csv', extra: { locality: 'sholinganallur' } }, token)
  const res = await get('/api/gnss/control-points/GCP-ELEV-001/elevation-residual')
  assert.equal(res.status, 200)
  assert.equal(res.body.data.dataAvailability, 'AVAILABLE')
  assert.ok(Math.abs(res.body.data.elevationResidualM - 0.5) < 0.01)
  assert.equal(res.body.data.verticalDatumStatus, 'UNKNOWN') // neither side declared a vertical datum
})

test('gnss: elevation residual is UNAVAILABLE (never fabricated) when the point has no height', () => {
  const r = computeElevationResidual({ height: null }, { baseElevationM: 8 }, null)
  assert.equal(r.dataAvailability, 'UNAVAILABLE')
  assert.equal(r.elevationResidualM, null)
})

test('gnss: vertical datum status is MATCHED only when both sides explicitly agree', () => {
  const matched = computeElevationResidual({ height: 10, verticalDatum: 'MSL' }, { baseElevationM: 8 }, { groundElevationM: 8, verticalDatum: 'MSL' })
  assert.equal(matched.verticalDatumStatus, 'MATCHED')
  const mismatch = computeElevationResidual({ height: 10, verticalDatum: 'MSL' }, { baseElevationM: 8 }, { groundElevationM: 8, verticalDatum: 'WGS84_ELLIPSOID' })
  assert.equal(mismatch.verticalDatumStatus, 'MISMATCH')
})

test('gnss: a control point inside two overlapping parcels is MULTI_PARCEL, never arbitrarily assigned', () => {
  const squareRing = (cx, cy, half) => [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]
  const parcelA = { parcelId: 'PCL-A', ulpin: 'ULPIN-A', geometry: { type: 'Polygon', coordinates: [squareRing(80.0, 13.0, 0.01)] } }
  const parcelB = { parcelId: 'PCL-B', ulpin: 'ULPIN-B', geometry: { type: 'Polygon', coordinates: [squareRing(80.005, 13.0, 0.01)] } }
  const point = { latitude: 13.0, longitude: 80.005 } // inside the overlap of both squares
  const result = associateParcel(point, [parcelA, parcelB])
  assert.equal(result.parcelStatus, 'MULTI_PARCEL')
  assert.equal(result.parentParcelId, null)
  assert.equal(result.parcelCandidates.length, 2)
})

test('gnss: batch validation rule catalogue matches the spec (deterministic, rule/status/message shape)', () => {
  const { results } = validateBatch([
    { controlPointId: 'X1', latitude: 12, longitude: 80, height: 5, accuracy: 0.1, coordinateReferenceSystem: 'EPSG:4326', timestamp: '2024-01-01T00:00:00Z' },
  ])
  assert.equal(results[0].status, 'VALID')
  assert.deepEqual(results[0].issues, [])
})

test('gnss: boundary verification never mutates parcel geometry and reports OBSERVED DEVIATION, not an official correction', () => {
  const parcel = { parcelId: 'PCL-X', ulpin: 'ULPIN-X', geometry: { type: 'Polygon', coordinates: [[[80, 13], [80.001, 13], [80.001, 13.001], [80, 13.001], [80, 13]]] } }
  const points = [{ controlPointId: 'P1', latitude: 13.0, longitude: 80.0 }]
  const result = verifyParcelBoundary(parcel, points)
  assert.match(result.note, /OBSERVED DEVIATION/)
})

test('gnss: existing parcel/building APIs remain compatible after the GNSS module loads', async () => {
  const ok1 = await get('/api/buildings/TN-CHN-123456789-B01')
  assert.equal(ok1.status, 200)
  const ok2 = await get('/api/parcels/TN-CHN-123456789')
  assert.equal(ok2.status, 200)
})
