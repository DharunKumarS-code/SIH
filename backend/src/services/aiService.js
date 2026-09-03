// AI feature gateway. If a Python AI microservice (ai-service/) is reachable it
// is proxied; otherwise the backend returns clearly-labelled LOCAL MOCK output
// so the frontend AI pages always work. Nothing here is a validated real-world
// prediction — every response carries mode: "demo" and a disclaimer.

import { env } from '../config/env.js'
import { db } from '../store/index.js'

const DISCLAIMER =
  'Demo inference only. Not a validated prediction. Model outputs are simulated for prototype demonstration.'

async function tryRemote(path, body) {
  if (!env.aiServiceUrl) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`${env.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const json = await res.json()
    return { ...json, servedBy: 'ai-service (FastAPI)' }
  } catch {
    return null
  }
}

const rand = (seedStr) => {
  let h = 2166136261
  for (const c of String(seedStr)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

export const AI_FEATURES = [
  { key: 'building-footprint', name: 'Building Footprint Detection', input: 'Satellite / drone tile', output: 'Polygon footprints + confidence' },
  { key: 'change-detection', name: 'Change Detection', input: 'Two-date imagery', output: 'New construction / expansion / demolition' },
  { key: 'floorplan-segmentation', name: 'Floor Plan Segmentation', input: 'Scanned floor plan', output: 'Rooms / units / common areas' },
  { key: 'height-estimation', name: 'Building Height Estimation', input: 'Imagery + shadow / DSM', output: 'Height (m) + floor count' },
  { key: 'risk-detection', name: 'Property Risk Detection', input: 'Records + spatial context', output: 'Risk flags (encroachment / mismatch / flood)' },
]

export async function runInference(feature, payload = {}) {
  const remote = await tryRemote(`/infer/${feature}`, payload)
  if (remote) return remote

  const base = {
    feature,
    mode: 'demo',
    servedBy: 'backend local mock',
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  }
  const r = rand(feature + JSON.stringify(payload))

  switch (feature) {
    case 'building-footprint': {
      const buildings = await db.collection('buildings').find({})
      return {
        ...base,
        detections: buildings.map((b) => ({
          candidateId: `det-${b.buildingSegment}`,
          geometry: b.geometry,
          confidence: Number((0.86 + rand(b.buildingId) * 0.12).toFixed(3)),
          matchedBuildingId: b.buildingId,
        })),
        summary: { detected: buildings.length, matchedToRecords: buildings.length },
      }
    }
    case 'change-detection':
      return {
        ...base,
        window: { from: payload.from || '2022-01', to: payload.to || '2025-01' },
        changes: [
          { changeId: 'chg-01', type: 'New Construction', geometryRef: 'PCL-CHN-SHLN-05', confidence: 0.91, review: 'pending' },
          { changeId: 'chg-02', type: 'Building Expansion', geometryRef: `${'TN-CHN-123456789'}-B04`, confidence: 0.78, review: 'pending' },
          { changeId: 'chg-03', type: r > 0.5 ? 'No Significant Change' : 'Demolition', geometryRef: 'PCL-CHN-SHLN-08', confidence: 0.63, review: 'pending' },
        ],
      }
    case 'floorplan-segmentation':
      return {
        ...base,
        floor: payload.floor || 'F02',
        segments: Array.from({ length: payload.units || 6 }).map((_, i) => ({
          label: `U${(payload.floorNumber || 2) * 100 + i + 1}`,
          class: 'unit',
          areaSqft: 900 + Math.round(rand(i) * 500),
          confidence: Number((0.8 + rand(i) * 0.15).toFixed(3)),
        })).concat([
          { label: 'CORRIDOR', class: 'common', areaSqft: 220, confidence: 0.88 },
          { label: 'STAIR', class: 'common', areaSqft: 140, confidence: 0.9 },
        ]),
      }
    case 'height-estimation': {
      const buildings = await db.collection('buildings').find({})
      return {
        ...base,
        estimates: buildings.map((b) => ({
          buildingId: b.buildingId,
          estimatedHeightM: Number((b.heightM + (rand(b.buildingId) - 0.5) * 3).toFixed(1)),
          recordedHeightM: b.heightM,
          estimatedFloors: b.totalFloors + (rand(b.buildingId) > 0.7 ? 1 : 0),
          method: 'shadow-length + DSM (simulated)',
        })),
      }
    }
    case 'risk-detection':
      return {
        ...base,
        ulpin: payload.ulpin || 'TN-CHN-123456789',
        risks: [
          { flag: 'Tax mismatch', severity: r > 0.6 ? 'medium' : 'low', detail: 'Assessed area differs from registered built-up area for some units.' },
          { flag: 'Encumbrance active', severity: 'info', detail: 'Parcel carries an active mortgage per EC adapter.' },
          { flag: 'Eco-sensitive proximity', severity: 'low', detail: 'Within 800 m of a demo eco-sensitive buffer.' },
        ],
        compositeRiskScore: Number((0.28 + r * 0.4).toFixed(2)),
      }
    default:
      return { ...base, error: `Unknown feature "${feature}"` }
  }
}

export async function aiStatus() {
  const remote = await tryRemote('/health', {})
  return {
    mode: remote ? 'connected' : 'demo',
    remote: Boolean(remote),
    url: env.aiServiceUrl || null,
    features: AI_FEATURES,
    disclaimer: DISCLAIMER,
    // Phase 3 — real image→polygon building extraction. Optional/additive: if the
    // Python ai-service is unreachable the endpoint returns INFERENCE_UNAVAILABLE
    // and the rest of the app is unaffected.
    buildingExtraction: {
      endpoint: '/api/ai/buildings/infer',
      aiServiceConfigured: Boolean(env.aiServiceUrl),
      supportedInput: ['png', 'jpg', 'jpeg', 'tif', 'tiff'],
      source: 'AI_DEMO',
      note: 'Model output — candidate building geometry only. Not official cadastral / ULPIN / survey data.',
    },
  }
}
