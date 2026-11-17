// /api/auth brute-force limiter regressions. Own file (own process) so the
// limiter window starts empty and the only failed auth attempts counted are
// the ones these tests make deliberately.

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
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await disconnectStore()
})

const get = async (path, token) => {
  const res = await fetch(base + path, token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
  return { status: res.status, headers: res.headers, body: res.status === 429 ? null : await res.json() }
}
const post = async (path, data, token) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: res.status === 429 ? null : await res.json() }
}
const login = (username, password) => post('/api/auth/login', { username, password })

/* ---------------- /api/auth rate limiter: counts FAILED attempts only ------
 * Order matters: the lockout test exhausts this process's quota, so it runs
 * last. */

test('auth limiter: successful logins do not consume the failed-attempt quota', async () => {
  // 40 > 30: if successes were counted, the 31st would be 429
  for (let i = 0; i < 40; i += 1) {
    const r = await login('survey01', 'Officer@123')
    assert.equal(r.status, 200, `successful login #${i + 1} got ${r.status}`)
    assert.ok(r.body.data.token)
  }
})

test('auth limiter: GET /auth/me is not counted, still requires a valid token', async () => {
  const token = (await login('land01', 'Officer@123')).body.data.token
  for (let i = 0; i < 50; i += 1) {
    const r = await get('/api/auth/me', token)
    assert.equal(r.status, 200, `/auth/me #${i + 1} got ${r.status}`)
  }
  assert.equal((await get('/api/auth/me')).status, 401) // no token
  assert.equal((await get('/api/auth/me', 'not.a.jwt')).status, 401) // bad token
})

test('auth limiter: many normal authenticated requests never hit 429; general /api limit stays 600', async () => {
  const token = (await login('admin01', 'Admin@123')).body.data.token
  const paths = ['/api/auth/me', '/api/parcels', '/api/buildings', '/api/notifications', '/api/users']
  for (let i = 0; i < 60; i += 1) {
    const r = await get(paths[i % paths.length], token)
    assert.notEqual(r.status, 429, `request #${i + 1} ${paths[i % paths.length]} was rate-limited`)
    assert.equal(r.status, 200)
  }
  const r = await get('/api/parcels', token)
  assert.equal(r.headers.get('ratelimit-limit'), '600')
})

test('auth limiter: 30 failed attempts per minute per IP, then 429 even for the right password', async () => {
  for (let i = 0; i < 30; i += 1) {
    const r = await login('survey01', `wrong-${i}`)
    assert.equal(r.status, 401, `failed attempt #${i + 1} got ${r.status}`)
  }
  assert.equal((await login('survey01', 'wrong-31')).status, 429)
  // brute-force lockout holds for correct credentials too until the window resets
  assert.equal((await login('survey01', 'Officer@123')).status, 429)
  // session checks with an existing token are unaffected by the auth lockout
  const token = signToken(await db.collection('users').findOne({ username: 'survey01' }))
  assert.equal((await get('/api/auth/me', token)).status, 200)
})
