// Thin client for the ai-service's /topology/* endpoints (Phase 7's only
// Python dependency — shapely-backed exact 2D polygon validity/overlap on
// planar coordinates). Same graceful-degradation pattern as
// gnss/crsClient.js and aiElevation's client: unreachable -> every affected
// polygon/pair comes back `available: false`, never a guessed validity or
// overlap result.

import { env } from '../../config/env.js'
import { TOPOLOGY_CONFIG } from './tolerances.js'

async function postJson(path, body, timeoutMs) {
  if (!env.aiServiceUrl) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${env.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.ok ? await res.json() : null
  } catch {
    clearTimeout(t)
    return null
  }
}

const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * @param {Array<{id:string, ring:number[][]}>} polygons
 * @returns {Promise<Map<string, {available:boolean, isValid:boolean|null, isSimple:boolean|null, areaM2:number|null, validityReason:string|null}>>}
 */
export async function analyzePolygons(polygons) {
  const out = new Map()
  if (!polygons.length) return out
  for (const batch of chunk(polygons, TOPOLOGY_CONFIG.maxGeometryBatch)) {
    const body = await postJson('/topology/analyze-polygons', { polygons: batch }, env.topologyGeometryTimeoutMs)
    if (!body) {
      for (const p of batch) out.set(p.id, { available: false, isValid: null, isSimple: null, areaM2: null, validityReason: null })
      continue
    }
    for (const r of body.results) out.set(r.id, r)
  }
  return out
}

/**
 * @param {Array<{idA:string, idB:string, ringA:number[][], ringB:number[][]}>} pairs
 * @returns {Promise<Map<string, {available:boolean, intersects:boolean|null, overlapAreaM2:number|null, iou:number|null}>>} keyed by `${idA}::${idB}`
 */
export async function polygonPairs(pairs) {
  const out = new Map()
  if (!pairs.length) return out
  for (const batch of chunk(pairs, TOPOLOGY_CONFIG.maxGeometryBatch)) {
    const body = await postJson('/topology/polygon-pairs', { pairs: batch }, env.topologyGeometryTimeoutMs)
    if (!body) {
      for (const p of batch) out.set(`${p.idA}::${p.idB}`, { available: false, intersects: null, overlapAreaM2: null, iou: null })
      continue
    }
    for (const r of body.results) out.set(`${r.idA}::${r.idB}`, r)
  }
  return out
}

/** GET /topology/config passthrough — null if the ai-service is unreachable. */
export async function topologyEngineConfig() {
  if (!env.aiServiceUrl) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${env.aiServiceUrl}/topology/config`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? await res.json() : null
  } catch {
    clearTimeout(t)
    return null
  }
}
