// ---------------------------------------------------------------------------
// TNGIS public-endpoint HTTP client.
//
// SAFETY MODEL (spec sections 2, 3, 16, 23):
//   - PUBLIC endpoints only. The only auth-ish requirement of the public
//     `generic_api` is a non-secret `x-app-name` header; GeoServer needs
//     nothing. No cookies, no session id, no CSRF token, no credentials are
//     ever sent or stored (Node's fetch does not attach cookies anyway).
//   - The authenticated `gi_viewer_api/gi_mvc/*` API is NEVER called from here.
//   - Every distinct upstream call is (a) served from a bundled offline fixture
//     when one exists, else (b) served from a short-lived in-memory cache, else
//     (c) fetched live behind a process-wide minimum-interval rate limiter and
//     a single bounded retry. This makes the integration deterministic offline
//     and structurally incapable of "crawling" TNGIS.
//   - `TNGIS_LIVE=0` disables live calls entirely (fixtures/cache only).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, '../../../../tests/fixtures/tngis')

const bool = (v, def) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()))

export const TNGIS = {
  genericApi: process.env.TNGIS_GENERIC_API || 'https://tngis.tn.gov.in/apps/generic_api',
  geoserver: process.env.TNGIS_GEOSERVER || 'https://tngis.tn.gov.in/app/wms',
  appName: process.env.TNGIS_APP_NAME || 'demo', // non-secret header the public generic_api requires
  timeoutMs: Number(process.env.TNGIS_TIMEOUT_MS) || 9000,
  minIntervalMs: Number(process.env.TNGIS_MIN_INTERVAL_MS) || 1200, // process-wide floor between live calls
  cacheTtlMs: Number(process.env.TNGIS_CACHE_TTL_MS) || 10 * 60 * 1000,
  wfsTypeName: process.env.TNGIS_WFS_TYPENAME || 'cadastral_analysis:cadastral_ulpin',
  // Re-read per call so a test / deploy can flip TNGIS_LIVE without a restart.
  get live() {
    return bool(process.env.TNGIS_LIVE, true)
  },
}

export class TngisSourceUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = 'TngisSourceUnavailable'
    this.code = 'TNGIS_SOURCE_UNAVAILABLE'
  }
}

// ---- fixtures ------------------------------------------------------------
const FIXTURES = {
  'admin:district': 'districts.json',
  'admin:taluk:02': 'taluks-02.json',
  'admin:village:02:11': 'villages-02-11.json',
  'admin:survey:02:11:013': 'surveys-02-11-013.json',
  'geom:survey_number:02:11:013:234': 'geom-02-11-013-234.json',
  'wfs:11:013:234': 'wfs-cadastral-02-11-013-234.json',
}

function fixture(key) {
  const name = FIXTURES[key]
  if (!name) return undefined
  const p = path.join(FIXTURE_DIR, name)
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return undefined
  }
}

// ---- rate limiter + cache --------------------------------------------------
let lastLiveAt = 0
const inFlight = new Map()
const cache = new Map() // key -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TNGIS.cacheTtlMs) return hit.value
  if (hit) cache.delete(key)
  return undefined
}
function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 200) cache.delete(cache.keys().next().value)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rateLimitedFetch(url, init) {
  const wait = TNGIS.minIntervalMs - (Date.now() - lastLiveAt)
  if (wait > 0) await sleep(wait)
  lastLiveAt = Date.now()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), TNGIS.timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: ac.signal, redirect: 'follow' })
      clearTimeout(t)
      if (!res.ok) throw new TngisSourceUnavailable(`TNGIS ${init?.method || 'GET'} ${url} -> HTTP ${res.status}`)
      return res
    } catch (err) {
      clearTimeout(t)
      if (attempt === 1) {
        throw err instanceof TngisSourceUnavailable
          ? err
          : new TngisSourceUnavailable(`TNGIS request failed: ${err.message}`)
      }
      await sleep(500)
    }
  }
  throw new TngisSourceUnavailable('TNGIS request failed')
}

/**
 * Resolve a logical TNGIS call: fixture → cache → (if allowed) live.
 * @param {string} cacheKey  stable key identifying the call
 * @param {() => Promise<any>} live  performs the actual network request
 */
async function resolve(cacheKey, live) {
  const fx = fixture(cacheKey)
  if (fx !== undefined) return fx

  const cached = cacheGet(cacheKey)
  if (cached !== undefined) return cached

  if (!TNGIS.live) {
    throw new TngisSourceUnavailable(
      `TNGIS live access is disabled (TNGIS_LIVE=0) and no fixture/cache exists for "${cacheKey}".`,
    )
  }

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey)
  const p = live()
    .then((value) => {
      cacheSet(cacheKey, value)
      inFlight.delete(cacheKey)
      return value
    })
    .catch((err) => {
      inFlight.delete(cacheKey)
      throw err
    })
  inFlight.set(cacheKey, p)
  return p
}

const jsonHeaders = { 'x-app-name': TNGIS.appName, accept: 'application/json' }

// ---- public call surface -------------------------------------------------

/** GET generic_api admin master list. `params` are appended verbatim. */
export function adminMaster(kind, params, cacheKey) {
  const url = new URL(`${TNGIS.genericApi}/v2/admin_master_${kind}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  return resolve(cacheKey, async () => {
    const res = await rateLimitedFetch(url.toString(), { method: 'GET', headers: jsonHeaders })
    return res.json()
  })
}

/** POST generic_api/v1/get_geom — exact form-encoded body discovered in phase 1. */
export function getGeom(form, cacheKey) {
  const body = new URLSearchParams(form).toString()
  return resolve(cacheKey, async () => {
    const res = await rateLimitedFetch(`${TNGIS.genericApi}/v1/get_geom`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-app-name': TNGIS.appName,
        'x-requested-with': 'XMLHttpRequest',
        accept: '*/*',
      },
      body,
    })
    return res.json()
  })
}

/** GeoServer WFS 2.0.0 GetFeature (GeoJSON) with a CQL filter — public, no auth. */
export function wfsGetFeature(cqlFilter, cacheKey, { count = 5 } = {}) {
  const url = new URL(TNGIS.geoserver)
  url.searchParams.set('service', 'WFS')
  url.searchParams.set('version', '2.0.0')
  url.searchParams.set('request', 'GetFeature')
  url.searchParams.set('typeNames', TNGIS.wfsTypeName)
  url.searchParams.set('outputFormat', 'application/json')
  url.searchParams.set('srsName', 'urn:ogc:def:crs:EPSG::4326')
  url.searchParams.set('count', String(count))
  url.searchParams.set('CQL_FILTER', cqlFilter)
  return resolve(cacheKey, async () => {
    const res = await rateLimitedFetch(url.toString(), { method: 'GET', headers: { accept: 'application/json' } })
    return res.json()
  })
}

/** Test-only: clear the in-memory cache + rate-limit clock. */
export function __resetClientState() {
  cache.clear()
  inFlight.clear()
  lastLiveAt = 0
}
