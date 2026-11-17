// Security regressions found in the stabilization audit. Own file (own
// process) so its /api/auth calls get a fresh rate-limit window instead of
// sharing api.test.js's, which already sits at the 30/min /api/auth cap.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { connectStore, disconnectStore, db } from '../src/store/index.js'
import { signToken } from '../src/services/authService.js'

let server
let base

test.before(async () => {
  await connectStore()
  await new Promise((resolve) => {
    server = createApp().listen(0, () => {
      base = `http://localhost:${server.address().port}`
      resolve()
    })
  })
})

test.after(async () => {
  // remove only the accounts this file created
  await db.collection('users').deleteMany({ username: { $regex: '^esc_' } })
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await disconnectStore()
})

const post = async (path, data, token) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: res.status === 429 ? null : await res.json() }
}

test('auth: anonymous self-registration cannot claim a privileged role; Administrator can', async () => {
  const u = `esc_${Date.now().toString(36)}`
  const anon = await post('/api/auth/register', { username: u, name: 'Escalation Probe', email: `${u}@demo.test`, password: 'secret123', role: 'Administrator' })
  assert.equal(anon.status, 403)
  const created = await db.collection('users').findOne({ username: u })
  assert.equal(created, null)

  const adminUser = await db.collection('users').findOne({ username: 'admin01' })
  const adminToken = signToken(adminUser)
  const byAdmin = await post('/api/auth/register', { username: `${u}o`, name: 'New Officer', email: `${u}o@demo.test`, password: 'secret123', role: 'Land Officer' }, adminToken)
  assert.equal(byAdmin.status, 200)
  assert.equal(byAdmin.body.data.user.role, 'Land Officer')
})
