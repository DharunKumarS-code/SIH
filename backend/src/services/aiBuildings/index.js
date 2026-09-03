// AI building-footprint extraction orchestrator (Phase 3, additive).
//
//   validated image  ->  Python ai-service /buildings/infer  ->  polygons
//   ->  parcel association (associate.js)  ->  aiBuildings docs  ->  Mongo
//
// If the Python service is unreachable / the model is unavailable, this returns
// { status: 'INFERENCE_UNAVAILABLE' } with HTTP 200 — it NEVER throws a 500 and
// the rest of the application is unaffected. AI output is always
// source: 'AI_DEMO' and never carries an official ULPIN / verified flag.

import { env } from '../../config/env.js'
import { db } from '../../store/index.js'
import { DEFAULT_LOCALITY_ID, getLocality } from '../../data/localities.js'
import { associateParcel } from './associate.js'

const DISCLAIMER =
  'AI_DEMO / MODEL OUTPUT. Automated candidate building geometry — NOT official ' +
  'cadastral, survey, ULPIN, ownership or building-approval data. Requires human review.'

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff'])
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/x-tiff',
  'application/octet-stream', // some clients send TIFFs as this
])

export class UploadValidationError extends Error {}

export function validateUpload(file, { maxMb = env.aiMaxUploadMb } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadValidationError('No image file provided.')
  const name = file.originalname || 'upload'
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  if (!ALLOWED_EXT.has(ext)) throw new UploadValidationError(`Unsupported file extension ".${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`)
  if (file.mimetype && !ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    throw new UploadValidationError(`Unsupported MIME type "${file.mimetype}".`)
  }
  const mb = file.buffer.length / (1024 * 1024)
  if (mb > maxMb) throw new UploadValidationError(`Image too large (${mb.toFixed(1)} MB > ${maxMb} MB limit).`)
  return { ext, name, sizeBytes: file.buffer.length }
}

let seq = Date.now() % 100000
const nextId = () => {
  seq += 1
  return `AI-CHN-${String(seq).padStart(6, '0')}`
}
const jobId = () => `AIJOB-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`

async function callPython(buffer, filename, locality, jid) {
  if (!env.aiServiceUrl) return { ok: false, reason: 'AI service not configured (AI_SERVICE_URL unset).' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), env.aiInferTimeoutMs)
  try {
    const form = new FormData()
    form.append('image', new Blob([buffer]), filename)
    if (locality) form.append('locality', locality)
    form.append('job_id', jid)
    const res = await fetch(`${env.aiServiceUrl}/buildings/infer`, { method: 'POST', body: form, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return { ok: false, reason: `ai-service HTTP ${res.status}` }
    const json = await res.json()
    return { ok: true, json }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, reason: `ai-service unreachable (${e.name === 'AbortError' ? 'timeout' : e.message})` }
  }
}

const confLevel = (c, high = 0.8, med = 0.55) => (c >= high ? 'HIGH' : c >= med ? 'MEDIUM' : 'LOW')

/**
 * @param {{ file, locality, user }} args  file = multer file, locality optional
 */
export async function inferBuildings({ file, locality, user }) {
  const meta = validateUpload(file) // throws UploadValidationError -> 400
  const loc = getLocality(locality || DEFAULT_LOCALITY_ID)
  const jid = jobId()
  const now = new Date().toISOString()

  await db.collection('aiJobs').create({
    jobId: jid,
    status: 'PROCESSING',
    imageName: meta.name,
    imageExt: meta.ext,
    imageBytes: meta.sizeBytes,
    locality: loc.id,
    requestedBy: user?.username || null,
    createdAt: now,
    source: 'AI_DEMO',
    disclaimer: DISCLAIMER,
  })

  const py = await callPython(file.buffer, meta.name, loc.id, jid)

  if (!py.ok || !py.json || ['MODEL_NOT_AVAILABLE', 'INFERENCE_UNAVAILABLE', 'FAILED'].includes(py.json.status)) {
    const reason = py.ok ? `${py.json.status}: ${py.json.error || py.json.errorKind || ''}`.trim() : py.reason
    // A genuine bad-input FAILED from Python should surface as 400 upstream.
    const badInput = py.ok && py.json?.errorKind === 'INVALID_INPUT'
    await db.collection('aiJobs').updateOne({ jobId: jid }, {
      status: 'FAILED', completedAt: new Date().toISOString(), error: reason,
    })
    return {
      jobId: jid,
      status: badInput ? 'INVALID_INPUT' : 'INFERENCE_UNAVAILABLE',
      reason,
      locality: loc.id,
      buildings: [],
      summary: null,
      disclaimer: DISCLAIMER,
    }
  }

  const out = py.json
  const parcels = out.georeferenced ? await db.collection('parcels').find({ locality: loc.id }) : []
  const stored = []

  for (const b of out.buildings || []) {
    const georef = Boolean(b.polygon && out.georeferenced)
    const assoc = georef
      ? associateParcel(b.polygon.coordinates[0], parcels)
      : { parcelStatus: 'OUTSIDE_PARCEL', parentParcelId: null, parentULPIN: null, parcelCandidates: [] }

    const clvl = b.confidenceLevel || confLevel(b.confidence, out.thresholds?.confHigh, out.thresholds?.confMed)
    const reviewRequired = Boolean(b.reviewRequired) || clvl === 'LOW' || b.geometryStatus !== 'VALID' ||
      assoc.parcelStatus === 'MULTI_PARCEL' || assoc.parcelStatus === 'REVIEW_REQUIRED'

    const doc = {
      aiBuildingId: nextId(),
      jobId: jid,
      localId: b.localId,
      // geometry: GeoJSON WGS-84 polygon (georeferenced) or null
      geometry: georef ? b.polygon : null,
      pixelPolygon: b.pixelPolygon || null,
      georeferenced: georef,
      geoStatus: georef ? 'GEOREFERENCED' : 'NON_GEOREFERENCED_AI_DEMO',
      // ---- provenance: explicitly non-official ----
      source: 'AI_DEMO',
      model: out.model || 'unknown',
      modelName: out.modelName || null,
      modelVersion: out.modelVersion || '0',
      timestamp: now,
      // ---- confidence ----
      confidence: b.confidence,
      confidenceLevel: clvl,
      // ---- geometry validation ----
      geometryStatus: b.geometryStatus || 'ERROR',
      geometryIssues: b.geometryIssues || [],
      areaM2: b.areaM2 ?? null,
      areaPx: b.areaPx ?? null,
      // ---- parcel association ----
      parcelStatus: assoc.parcelStatus,
      parentParcelId: assoc.parentParcelId,
      parentULPIN: assoc.parentULPIN, // existing parcel ULPIN (Phase-1 value) or null
      ulpinStatus: 'DEMO_NOT_OFFICIAL',
      parcelCandidates: assoc.parcelCandidates,
      // ---- height: never fabricated ----
      height: null,
      heightStatus: 'UNAVAILABLE',
      // ---- review workflow ----
      reviewRequired,
      reviewStatus: 'REVIEW_REQUIRED',
      locality: loc.id,
      isDemo: true,
      disclaimer: DISCLAIMER,
    }
    await db.collection('aiBuildings').create(doc)
    stored.push(doc)
  }

  const summary = {
    total: stored.length,
    high: stored.filter((d) => d.confidenceLevel === 'HIGH').length,
    medium: stored.filter((d) => d.confidenceLevel === 'MEDIUM').length,
    low: stored.filter((d) => d.confidenceLevel === 'LOW').length,
    invalidGeometry: stored.filter((d) => d.geometryStatus === 'ERROR').length,
    warningGeometry: stored.filter((d) => d.geometryStatus === 'WARNING').length,
    matched: stored.filter((d) => d.parcelStatus === 'MATCHED').length,
    multiParcel: stored.filter((d) => d.parcelStatus === 'MULTI_PARCEL').length,
    outsideParcel: stored.filter((d) => d.parcelStatus === 'OUTSIDE_PARCEL').length,
    reviewRequired: stored.filter((d) => d.reviewRequired).length,
    georeferenced: out.georeferenced,
  }

  await db.collection('aiJobs').updateOne({ jobId: jid }, {
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
    model: out.model,
    modelVersion: out.modelVersion,
    georeferenced: out.georeferenced,
    geoStatus: out.geoStatus,
    servedBy: out.servedBy || 'ai-service',
    summary,
    notes: out.notes || [],
  })

  return {
    jobId: jid,
    status: 'COMPLETED',
    locality: loc.id,
    model: out.model,
    modelName: out.modelName,
    modelVersion: out.modelVersion,
    georeferenced: out.georeferenced,
    geoStatus: out.geoStatus,
    thresholds: out.thresholds,
    summary,
    buildings: stored,
    notes: out.notes || [],
    disclaimer: DISCLAIMER,
  }
}

export { DISCLAIMER as AI_BUILDINGS_DISCLAIMER }
