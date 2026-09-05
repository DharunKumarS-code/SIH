// AI floor-plan & apartment/unit segmentation orchestrator (Phase 4, additive).
//
//   validated image  ->  Python ai-service /floorplans/infer  ->  walls/rooms/units
//   ->  building/floor association (associate.js)  ->  aiFloorPlans / aiRooms /
//       aiFloorUnits docs  ->  Mongo (existing Atlas; NO migration, NO PostGIS)
//
// If the Python service is unreachable / the model is unavailable, this returns
// { status: 'INFERENCE_UNAVAILABLE' } with HTTP 200 — it NEVER throws a 500 and
// the rest of the application is unaffected. Output is always source 'AI_DEMO',
// dataClassification 'DEMO_RESEARCH_DATA' (dataset: CubiCasa5K), and never
// carries an official ULPIN or a verified flag.

import { env } from '../../config/env.js'
import { db } from '../../store/index.js'
import { DEFAULT_LOCALITY_ID, getLocality } from '../../data/localities.js'
import { associateFloorPlan } from './associate.js'

export const AI_FLOORPLANS_DISCLAIMER =
  'AI_DEMO / MODEL OUTPUT / DEMO_RESEARCH_DATA (dataset: CubiCasa5K). Automated ' +
  'floor-plan geometry, room labels and apartment/unit boundaries — NOT official ' +
  'Tamil Nadu cadastral, Chennai building-approval, ULPIN, ownership or legally ' +
  'authoritative apartment-boundary data. Requires human review.'

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff'])
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/x-tiff',
  'application/octet-stream',
])

export class UploadValidationError extends Error {}

export function validateUpload(file, { maxMb = env.aiMaxUploadMb } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadValidationError('No image file provided.')
  const name = file.originalname || 'upload'
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  if (!ALLOWED_EXT.has(ext)) {
    throw new UploadValidationError(`Unsupported file extension ".${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`)
  }
  if (file.mimetype && !ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    throw new UploadValidationError(`Unsupported MIME type "${file.mimetype}".`)
  }
  // sniff magic bytes — never trust the extension alone
  const b = file.buffer
  const isPng = b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  const isJpg = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const isTiff = b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00))
  if (!isPng && !isJpg && !isTiff) throw new UploadValidationError('File content is not a PNG, JPEG or TIFF image.')
  const mb = b.length / (1024 * 1024)
  if (mb > maxMb) throw new UploadValidationError(`Image too large (${mb.toFixed(1)} MB > ${maxMb} MB limit).`)
  return { ext, name, sizeBytes: b.length }
}

let seq = Date.now() % 100000
const nextPlanId = () => {
  seq += 1
  return `AIFP-CHN-${String(seq).padStart(6, '0')}`
}
const jobId = () => `FPJOB-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`

const confLevel = (c, high = 0.8, med = 0.55) => (c >= high ? 'HIGH' : c >= med ? 'MEDIUM' : 'LOW')

async function callPython(buffer, filename, form) {
  if (!env.aiServiceUrl) return { ok: false, reason: 'AI service not configured (AI_SERVICE_URL unset).' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), env.aiInferTimeoutMs)
  try {
    const fd = new FormData()
    fd.append('image', new Blob([buffer]), filename)
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined && v !== null && v !== '') fd.append(k, String(v))
    }
    const res = await fetch(`${env.aiServiceUrl}/floorplans/infer`, { method: 'POST', body: fd, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return { ok: false, reason: `ai-service HTTP ${res.status}` }
    return { ok: true, json: await res.json() }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, reason: `ai-service unreachable (${e.name === 'AbortError' ? 'timeout' : e.message})` }
  }
}

async function resolveRefs({ buildingId, floorId, parcelId }) {
  let building = null
  let floor = null
  let parentULPIN = null
  let locality = DEFAULT_LOCALITY_ID
  if (buildingId) {
    building = await db.collection('buildings').findOne({ buildingId })
    if (building) {
      parentULPIN = building.ulpin || null
      if (building.locality) locality = building.locality
    }
  }
  if (floorId) floor = await db.collection('floors').findOne({ floorId })
  return { building, floor, parentULPIN, parcelId: parcelId || building?.parcelId || null, locality }
}

/**
 * @param {{ file, user, buildingId?, floorId?, parcelId?, scaleMPerPx? }} args
 */
export async function inferFloorPlan({ file, user, buildingId, floorId, parcelId, scaleMPerPx }) {
  const meta = validateUpload(file) // throws UploadValidationError -> 400
  const jid = jobId()
  const now = new Date().toISOString()

  const { building, floor, parentULPIN, parcelId: pId, locality } = await resolveRefs({ buildingId, floorId, parcelId })
  const loc = getLocality(locality)

  await db.collection('aiJobs').create({
    jobId: jid,
    kind: 'floorplan',
    status: 'PROCESSING',
    imageName: meta.name,
    imageExt: meta.ext,
    imageBytes: meta.sizeBytes,
    buildingId: building?.buildingId || buildingId || null,
    floorId: floor?.floorId || floorId || null,
    locality: loc.id,
    requestedBy: user?.username || null,
    createdAt: now,
    source: 'AI_DEMO',
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  })

  // let the Python side apply the floor z-range if we already know it
  const zmin = floor ? (floor.volume?.zmin ?? floor.baseHeight) : null
  const zmax = floor ? (floor.volume?.zmax ?? floor.topHeight) : null
  const floorElevationM = Number.isFinite(zmin) ? zmin : null
  const floorHeightM = Number.isFinite(zmin) && Number.isFinite(zmax) && zmax > zmin ? Number((zmax - zmin).toFixed(3)) : null

  const py = await callPython(file.buffer, meta.name, {
    job_id: jid,
    building_id: building?.buildingId || buildingId || '',
    floor_id: floor?.floorId || floorId || '',
    parcel_id: pId || '',
    scale_m_per_px: scaleMPerPx || '',
    floor_elevation_m: floorElevationM ?? '',
    floor_height_m: floorHeightM ?? '',
  })

  if (!py.ok || !py.json || ['MODEL_NOT_AVAILABLE', 'INFERENCE_UNAVAILABLE', 'FAILED'].includes(py.json.status)) {
    const reason = py.ok ? `${py.json.status}: ${py.json.error || py.json.errorKind || ''}`.trim() : py.reason
    const badInput = py.ok && py.json?.errorKind === 'INVALID_INPUT'
    await db.collection('aiJobs').updateOne({ jobId: jid }, {
      status: 'FAILED', completedAt: new Date().toISOString(), error: reason,
    })
    return {
      jobId: jid,
      status: badInput ? 'INVALID_INPUT' : 'INFERENCE_UNAVAILABLE',
      reason,
      floorPlanId: null,
      rooms: [],
      units: [],
      summary: null,
      disclaimer: AI_FLOORPLANS_DISCLAIMER,
    }
  }

  const out = py.json
  const { assoc, projectUnit, validationIssues } = associateFloorPlan({
    pyResult: out, building, floor, parcelId: pId, parcelULPIN: parentULPIN,
  })

  const planId = nextPlanId()
  const mergedValidation = {
    status: out.validation?.status || 'VALID',
    counts: out.validation?.counts || {},
    issues: [...(out.validation?.issues || []), ...validationIssues],
  }
  if (validationIssues.some((i) => i.status === 'ERROR')) mergedValidation.status = 'ERROR'
  else if (mergedValidation.status !== 'ERROR' && validationIssues.some((i) => i.status === 'WARNING')) {
    mergedValidation.status = mergedValidation.status === 'VALID' ? 'WARNING' : mergedValidation.status
  }

  const planDoc = {
    floorPlanId: planId,
    jobId: jid,
    source: 'AI_DEMO',
    dataClassification: out.dataClassification || 'DEMO_RESEARCH_DATA',
    dataset: out.dataset || 'CubiCasa5K',
    model: out.model || 'classical-cv',
    modelName: out.modelName || null,
    modelVersion: out.modelVersion || '0',
    modelVocab: out.modelVocab || 'classical',
    classMap: out.classMap || {},
    timestamp: now,
    imageName: meta.name,
    imageSize: out.imageSize || null,
    crs: assoc.georeferenced ? 'GEOREFERENCED_VIA_BUILDING' : (out.crs || 'LOCAL_FLOORPLAN_PIXEL'),
    coordinateReference: out.coordinateReference || null,
    scaleMPerPx: out.scaleMPerPx ?? null,
    buildingId: assoc.buildingId,
    floorId: assoc.floorId,
    parentParcelId: assoc.parentParcelId,
    parentULPIN: assoc.parentULPIN,
    ulpinStatus: 'DEMO_NOT_OFFICIAL',
    georeferenced: assoc.georeferenced,
    geoStatus: assoc.geoStatus,
    floorElevationM: assoc.floorElevationM,
    floorHeightM: assoc.floorHeightM,
    transformNote: assoc.transformNote,
    thresholds: out.thresholds || {},
    topology: out.topology || { nodes: [], edges: [] },
    walls: {
      count: out.walls?.count || 0,
      centrelineSegments: out.walls?.centrelineSegments || [],
    },
    doors: out.doors || [],
    openings: out.openings || [],
    windows: out.windows || [],
    unclassified: out.unclassified || [],
    validation: mergedValidation,
    summary: out.summary || {},
    notes: out.notes || [],
    locality: loc.id,
    reviewStatus: 'REVIEW_REQUIRED',
    reviewRequired: true,
    isDemo: true,
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  }
  await db.collection('aiFloorPlans').create(planDoc)

  // ---- rooms ----
  const storedRooms = []
  for (const r of out.rooms || []) {
    const clvl = r.confidenceLevel || confLevel(r.confidence, out.thresholds?.confHigh, out.thresholds?.confMed)
    const doc = {
      roomId: `${planId}-${r.roomId}`,
      localRoomId: r.roomId,
      floorPlanId: planId,
      jobId: jid,
      class: r.class,
      roomType: r.roomType,
      localPolygon: r.polygon || (r.pixelPolygon ? { type: 'Polygon', coordinates: [r.pixelPolygon] } : null),
      pixelPolygon: r.pixelPolygon || null,
      area: r.area ?? null,
      areaPx: r.areaPx ?? null,
      areaUnit: r.areaUnit || 'PIXEL_SQUARED',
      areaStatus: r.areaStatus || 'SCALE_UNAVAILABLE',
      confidence: r.confidence,
      confidenceLevel: clvl,
      typeConfidence: r.typeConfidence ?? null,
      geometryStatus: r.geometryStatus || 'ERROR',
      geometryIssues: r.geometryIssues || [],
      source: 'AI_DEMO',
      dataClassification: 'DEMO_RESEARCH_DATA',
      model: r.model || out.model || 'classical-cv',
      modelVersion: r.modelVersion || out.modelVersion || '0',
      floorId: assoc.floorId,
      reviewRequired: Boolean(r.reviewRequired) || clvl === 'LOW' || r.geometryStatus !== 'VALID',
      reviewStatus: 'REVIEW_REQUIRED',
      isDemo: true,
    }
    await db.collection('aiRooms').create(doc)
    storedRooms.push(doc)
  }

  // ---- units ----
  const storedUnits = []
  const outUnits = out.units || []
  for (let i = 0; i < outUnits.length; i += 1) {
    const u = outUnits[i]
    const clvl = u.confidenceLevel || confLevel(u.confidence, out.thresholds?.confHigh, out.thresholds?.confMed)
    const proj = projectUnit(u, i)
    const vv = proj.volumeValidation
    const reviewRequired = Boolean(u.reviewRequired) || clvl === 'LOW' || u.geometryStatus !== 'VALID' ||
      (u.ambiguityReasons || []).length > 0 || (vv && vv.status !== 'VALID')

    const doc = {
      aiFloorUnitId: `${planId}-${u.unitId}`,
      localUnitId: u.unitId,
      floorPlanId: planId,
      jobId: jid,
      floorId: assoc.floorId,
      buildingId: assoc.buildingId,
      parentParcelId: assoc.parentParcelId,
      parentULPIN: assoc.georeferenced ? assoc.parentULPIN : null, // EXISTING parcel ULPIN, or null
      ulpinStatus: 'DEMO_NOT_OFFICIAL',
      rooms: (u.rooms || []).map((rid) => `${planId}-${rid}`),
      roomTypes: u.roomTypes || [],
      localBoundary: proj.localGeometry,
      localVolume: proj.localVolume,
      geometry: proj.geometry,          // WGS84 GeoJSON polygon, or null
      volume: proj.volume,              // Phase-2 prototype volume (xmin..zmax), or null
      volumeValidation: vv,
      area: u.area ?? null,
      areaPx: u.areaPx ?? null,
      areaUnit: u.areaUnit || 'PIXEL_SQUARED',
      areaStatus: u.areaStatus || 'SCALE_UNAVAILABLE',
      confidence: u.confidence,
      confidenceLevel: clvl,
      geometryStatus: u.geometryStatus || 'ERROR',
      ambiguityReasons: u.ambiguityReasons || [],
      source: 'AI_DEMO',
      dataClassification: 'DEMO_RESEARCH_DATA',
      dataset: out.dataset || 'CubiCasa5K',
      model: u.model || out.model || 'classical-cv',
      modelVersion: u.modelVersion || out.modelVersion || '0',
      timestamp: now,
      georeferenced: Boolean(proj.geometry),
      geoStatus: proj.geometry ? 'GEOREFERENCED_VIA_BUILDING' : 'NON_GEOREFERENCED_AI_DEMO',
      heightStatus: proj.volume && Number.isFinite(proj.volume.zmin) ? 'ESTIMATED' : 'UNAVAILABLE',
      reviewRequired,
      reviewStatus: 'REVIEW_REQUIRED',
      locality: loc.id,
      isDemo: true,
      disclaimer: AI_FLOORPLANS_DISCLAIMER,
    }
    await db.collection('aiFloorUnits').create(doc)
    storedUnits.push(doc)
  }

  const summary = {
    walls: out.summary?.walls ?? planDoc.walls.count,
    rooms: storedRooms.length,
    doors: (out.doors || []).length,
    windows: (out.windows || []).length,
    units: storedUnits.length,
    commonAreas: (out.commonAreas || []).length,
    unclassified: (out.unclassified || []).length,
    high: storedUnits.filter((d) => d.confidenceLevel === 'HIGH').length +
      storedRooms.filter((d) => d.confidenceLevel === 'HIGH').length,
    medium: storedUnits.filter((d) => d.confidenceLevel === 'MEDIUM').length +
      storedRooms.filter((d) => d.confidenceLevel === 'MEDIUM').length,
    low: storedUnits.filter((d) => d.confidenceLevel === 'LOW').length +
      storedRooms.filter((d) => d.confidenceLevel === 'LOW').length,
    invalidGeometry: storedUnits.filter((d) => d.geometryStatus === 'ERROR').length +
      storedRooms.filter((d) => d.geometryStatus === 'ERROR').length,
    reviewRequired: storedUnits.filter((d) => d.reviewRequired).length +
      storedRooms.filter((d) => d.reviewRequired).length,
    georeferenced: assoc.georeferenced,
    validationStatus: mergedValidation.status,
  }

  await db.collection('aiFloorPlans').updateOne({ floorPlanId: planId }, { summary })
  await db.collection('aiJobs').updateOne({ jobId: jid }, {
    status: storedRooms.length || storedUnits.length ? (out.status === 'NO_STRUCTURE' ? 'NO_STRUCTURE' : 'COMPLETED') : 'NO_STRUCTURE',
    completedAt: new Date().toISOString(),
    floorPlanId: planId,
    model: out.model,
    modelVersion: out.modelVersion,
    georeferenced: assoc.georeferenced,
    geoStatus: assoc.geoStatus,
    servedBy: out.servedBy || 'ai-service',
    summary,
    notes: out.notes || [],
  })

  return {
    jobId: jid,
    status: 'COMPLETED',
    floorPlanId: planId,
    locality: loc.id,
    model: out.model,
    modelName: out.modelName,
    modelVersion: out.modelVersion,
    dataset: out.dataset || 'CubiCasa5K',
    dataClassification: out.dataClassification || 'DEMO_RESEARCH_DATA',
    georeferenced: assoc.georeferenced,
    geoStatus: assoc.geoStatus,
    crs: planDoc.crs,
    coordinateReference: out.coordinateReference || null,
    scaleMPerPx: out.scaleMPerPx ?? null,
    buildingId: assoc.buildingId,
    floorId: assoc.floorId,
    parentULPIN: planDoc.parentULPIN,
    ulpinStatus: 'DEMO_NOT_OFFICIAL',
    thresholds: out.thresholds,
    summary,
    validation: mergedValidation,
    topology: out.topology || { nodes: [], edges: [] },
    walls: planDoc.walls,
    rooms: storedRooms,
    units: storedUnits,
    commonAreas: out.commonAreas || [],
    unclassified: out.unclassified || [],
    notes: out.notes || [],
    disclaimer: AI_FLOORPLANS_DISCLAIMER,
  }
}
