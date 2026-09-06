// Phase 10 — Governance overview roll-up (additive, read-only). Verifies the
// aggregator endpoint reads existing collections and never asserts official
// connectivity. Same harness conventions as tests/identifier3d.test.js
// (node:test + raw fetch against an ephemeral server, seeded DEMO fixtures).

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore } from '../src/store/index.js'

let app
let server
let base

test.before(async () => {
  await connectStore()
  app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; resolve() })
  })
})

test.after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await disconnectStore()
})

const get = async (p) => {
  const res = await fetch(base + p)
  const json = await res.json()
  return { status: res.status, body: json.data ?? json }
}

test('governance: GET /governance/overview returns a read-only DEMO roll-up of existing records', async () => {
  const { status, body } = await get('/api/governance/overview')
  assert.equal(status, 200)
  assert.equal(body.isDemo, true)
  assert.ok(typeof body.disclaimer === 'string' && body.disclaimer.length > 0)

  // Data-source registry comes straight from the Phase 1 investigation list.
  assert.ok(Array.isArray(body.dataSources?.sources))
  assert.ok(body.dataSources.sources.length > 0)
  assert.ok(['UNAVAILABLE', 'PARTIAL', 'AVAILABLE'].includes(body.dataSources.chennaiAvailability))

  // Holdings are numeric counts of existing collections (seeded DEMO data).
  for (const k of ['parcels', 'buildings', 'units', 'undergroundInfrastructure', 'proposed3DIdentifiers']) {
    assert.equal(typeof body.holdings?.[k], 'number', `holdings.${k} is a number`)
  }
  assert.ok(body.holdings.parcels > 0)

  // Pending reviews / requests / documents / audit are all present as objects.
  assert.equal(typeof body.pendingReviews?.total, 'number')
  assert.equal(typeof body.governanceRequests?.total, 'number')
  assert.equal(typeof body.documents?.total, 'number')
  assert.ok(Array.isArray(body.audit?.recent))
})

test('governance: the roll-up never promotes DEMO data to official / authoritative', async () => {
  const { body } = await get('/api/governance/overview')
  const blob = JSON.stringify(body).toLowerCase()
  // The word "official" may appear in the source-investigation dataset names,
  // but the payload must not claim official connectivity or authority.
  assert.ok(!blob.includes('"authoritative":true'))
  assert.ok(!blob.includes('"official":true'))
  assert.equal(body.isDemo, true)
})
