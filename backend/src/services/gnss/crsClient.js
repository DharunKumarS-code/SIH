// Thin client for the ai-service's /gnss/transform endpoint (Phase 6's only
// Python dependency — pyproj-backed CRS transformation). Same
// graceful-degradation pattern as services/aiElevation/index.js: unreachable
// -> TRANSFORMATION_UNAVAILABLE, never a guessed/silent transform.

import { env } from '../../config/env.js'

/**
 * @param {Array<{x:number, y:number}>} points
 * @param {string|null} sourceCRS
 * @param {string} [targetCRS]
 */
export async function transformPoints(points, sourceCRS, targetCRS = 'EPSG:4326') {
  if (!env.aiServiceUrl) {
    return { status: 'TRANSFORMATION_UNAVAILABLE', transformApplied: false, points: points.map(() => null), note: 'AI service not configured (AI_SERVICE_URL unset).' }
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), env.gnssTransformTimeoutMs)
  try {
    const res = await fetch(`${env.aiServiceUrl}/gnss/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points, sourceCRS, targetCRS }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) {
      return { status: 'TRANSFORMATION_UNAVAILABLE', transformApplied: false, points: points.map(() => null), note: `ai-service HTTP ${res.status}` }
    }
    return await res.json()
  } catch (e) {
    clearTimeout(t)
    return {
      status: 'TRANSFORMATION_UNAVAILABLE', transformApplied: false, points: points.map(() => null),
      note: `ai-service unreachable (${e.name === 'AbortError' ? 'timeout' : e.message})`,
    }
  }
}

/** GET /gnss/config passthrough. */
export async function gnssConfig() {
  if (!env.aiServiceUrl) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${env.aiServiceUrl}/gnss/config`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? await res.json() : null
  } catch {
    clearTimeout(t)
    return null
  }
}
