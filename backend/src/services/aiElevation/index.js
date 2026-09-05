// Elevation / LiDAR / DEM / DSM orchestrator (Phase 5, additive).
//
//   validated DEM/DSM/LAS/LAZ  ->  Python ai-service /elevation/*  ->  DEM/DSM
//   metadata + per-building height  ->  buildingHeights docs  ->  Mongo
//
// Raw point-cloud / raster bytes are NEVER persisted — each request re-sends
// the file(s) to the stateless ai-service (same pattern as Phase 3/4 image
// inference); only derived metadata + results are stored. If the Python
// service is unreachable this returns { status: 'INFERENCE_UNAVAILABLE' } with
// HTTP 200 — it NEVER throws a 500. Output is always source 'ELEVATION_DEMO'
// (or RESEARCH_DATA / TEST_FIXTURE / USER_SUPPLIED) and isOfficial: false.

import { env } from '../../config/env.js'
import { db } from '../../store/index.js'
import { DEFAULT_LOCALITY_ID, getLocality } from '../../data/localities.js'

export const AI_ELEVATION_DISCLAIMER =
  'ELEVATION_DEMO / MODEL OUTPUT. Building height, ground and roof elevation are ' +
  'estimated from DSM-minus-DEM analysis of demo/research or user-supplied ' +
  'elevation data. NOT official, survey-certified or government-authoritative ' +
  'elevation data. Requires human review.'

const EXT_BY_TYPE = { DEM: ['tif', 'tiff'], DSM: ['tif', 'tiff'], POINTCLOUD: ['las', 'laz'] }

export class UploadValidationError extends Error {}

export function validateElevationUpload(file, datasetType, { maxMb = env.aiMaxElevationUploadMb } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadValidationError('No file provided.')
  const type = String(datasetType || '').toUpperCase()
  const allowedExt = EXT_BY_TYPE[type]
  if (!allowedExt) throw new UploadValidationError('datasetType must be one of DEM, DSM, POINTCLOUD.')
  const name = file.originalname || 'upload'
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  if (!allowedExt.includes(ext)) {
    throw new UploadValidationError(`Unsupported file extension ".${ext}" for ${type}. Allowed: ${allowedExt.join(', ')}`)
  }
  const b = file.buffer
  if (type === 'POINTCLOUD') {
    if (b.length < 4 || b.slice(0, 4).toString('ascii') !== 'LASF') {
      throw new UploadValidationError('File content is not a LAS/LAZ point cloud (missing the "LASF" signature).')
    }
  } else {
    const isTiff = b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00))
    if (!isTiff) throw new UploadValidationError('File content is not a GeoTIFF (missing the TIFF byte-order signature).')
  }
  const mb = b.length / (1024 * 1024)
  if (mb > maxMb) throw new UploadValidationError(`File too large (${mb.toFixed(1)} MB > ${maxMb} MB limit).`)
  return { ext, name, sizeBytes: b.length, type }
}

let seq = Date.now() % 100000
const nextDatasetId = () => {
  seq += 1
  return `ELEV-CHN-${String(seq).padStart(6, '0')}`
}
const jobId = () => `ELEVJOB-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`

async function callPython(path, { files = {}, fields = {} } = {}) {
  if (!env.aiServiceUrl) return { ok: false, reason: 'AI service not configured (AI_SERVICE_URL unset).' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), env.aiElevationTimeoutMs)
  try {
    const form = new FormData()
    for (const [k, f] of Object.entries(files)) {
      if (f) form.append(k, new Blob([f.buffer]), f.originalname || k)
    }
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== '') form.append(k, String(v))
    }
    const res = await fetch(`${env.aiServiceUrl}${path}`, { method: 'POST', body: form, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return { ok: false, reason: `ai-service HTTP ${res.status}` }
    return { ok: true, json: await res.json() }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, reason: `ai-service unreachable (${e.name === 'AbortError' ? 'timeout' : e.message})` }
  }
}

/** GET /elevation/config passthrough — the pipeline stages + thresholds shown in the UI. */
export async function elevationConfig() {
  if (!env.aiServiceUrl) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${env.aiServiceUrl}/elevation/config`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? await res.json() : null
  } catch {
    clearTimeout(t)
    return null
  }
}

/**
 * Validate a single DEM / DSM / point-cloud upload against the Python service.
 * Stores metadata-only provenance in `elevationDatasets` — never the raw bytes.
 */
export async function validateDataset({ file, datasetType, locality, sourceLabel, datasetName, user }) {
  const meta = validateElevationUpload(file, datasetType) // throws UploadValidationError -> 400
  const loc = getLocality(locality || DEFAULT_LOCALITY_ID)
  const id = nextDatasetId()
  const now = new Date().toISOString()

  const py = await callPython('/elevation/validate', {
    files: { file },
    fields: { dataset_type: meta.type, source_label: sourceLabel, dataset_name: datasetName || meta.name },
  })

  const base = {
    datasetId: id,
    datasetType: meta.type,
    fileName: meta.name,
    fileBytes: meta.sizeBytes,
    locality: loc.id,
    uploadedBy: user?.username || null,
    createdAt: now,
    disclaimer: AI_ELEVATION_DISCLAIMER,
    isDemo: true,
  }

  if (!py.ok) {
    const doc = { ...base, status: 'FAILED', error: py.reason, source: null, provenance: null }
    await db.collection('elevationDatasets').create(doc)
    return doc
  }

  const out = py.json
  const invalidInput = out.status === 'FAILED' && out.errorKind === 'INVALID_INPUT'
  const doc = {
    ...base,
    status: out.status === 'FAILED' ? 'FAILED' : out.status === 'INVALID' ? 'INVALID' : 'VALIDATED',
    validationStatus: out.validationStatus || null,
    metadata: out.metadata || null,
    issues: out.issues || [],
    provenance: out.provenance || null,
    error: out.status === 'FAILED' ? out.error : null,
    source: out.provenance?.source || null,
  }
  await db.collection('elevationDatasets').create(doc)
  return { ...doc, invalidInput }
}

async function resolveFootprints({ buildingIds, locality }) {
  let buildings = []
  if (Array.isArray(buildingIds) && buildingIds.length) {
    buildings = await db.collection('buildings').find({ buildingId: { $in: buildingIds } })
  } else if (locality) {
    buildings = await db.collection('buildings').find({ locality })
  }
  const footprints = buildings.filter((b) => b.geometry).map((b) => ({ buildingId: b.buildingId, polygon: b.geometry }))
  return { buildings, footprints }
}

/**
 * Run the full DSM-minus-DEM pipeline for a set of buildings (by id, or every
 * building in a locality) against an uploaded DEM/DSM pair or a LAS/LAZ point
 * cloud. Stores one `buildingHeights` result per building — it never touches
 * the `buildings` collection itself (see heightIntegration.js for the
 * separate, explicit, reversible accept/revert step).
 */
export async function processElevation({
  dem, dsm, pointcloud, buildingIds, locality, bufferM, sourceLabel, datasetName,
  verticalDatumDem, verticalDatumDsm, user,
}) {
  if (dem) validateElevationUpload(dem, 'DEM')
  if (dsm) validateElevationUpload(dsm, 'DSM')
  if (pointcloud) validateElevationUpload(pointcloud, 'POINTCLOUD')
  if (!dem && !dsm && !pointcloud) {
    throw new UploadValidationError('Provide a DEM and/or DSM raster, or a LAS/LAZ point cloud.')
  }

  const jid = jobId()
  const now = new Date().toISOString()
  const { footprints } = await resolveFootprints({ buildingIds, locality })
  if (!footprints.length) {
    throw new UploadValidationError('No building footprints resolved for the given buildingIds/locality.')
  }

  await db.collection('aiJobs').create({
    jobId: jid, kind: 'elevation', status: 'PROCESSING', locality: locality || null,
    buildingCount: footprints.length, requestedBy: user?.username || null, createdAt: now,
    source: 'ELEVATION_DEMO', disclaimer: AI_ELEVATION_DISCLAIMER,
  })

  const py = await callPython('/elevation/process', {
    files: { dem, dsm, pointcloud },
    fields: {
      footprints: JSON.stringify(footprints), buffer_m: bufferM, source_label: sourceLabel,
      dataset_name: datasetName, vertical_datum_dem: verticalDatumDem, vertical_datum_dsm: verticalDatumDsm,
    },
  })

  if (!py.ok || !py.json || py.json.status === 'FAILED') {
    const reason = py.ok ? `${py.json.status}: ${py.json.error || ''}`.trim() : py.reason
    const badInput = py.ok && py.json?.errorKind === 'INVALID_INPUT'
    await db.collection('aiJobs').updateOne({ jobId: jid }, {
      status: 'FAILED', completedAt: new Date().toISOString(), error: reason,
    })
    return {
      jobId: jid, status: badInput ? 'INVALID_INPUT' : 'INFERENCE_UNAVAILABLE', reason,
      buildings: [], summary: null, disclaimer: AI_ELEVATION_DISCLAIMER,
    }
  }

  const out = py.json
  const stored = []
  for (const r of out.buildings || []) {
    const existing = await db.collection('buildings').findOne({ buildingId: r.buildingId })
    const doc = {
      buildingHeightId: `${r.buildingId}-${jid}`,
      buildingId: r.buildingId,
      jobId: jid,
      groundElevationM: r.groundElevationM,
      roofElevationM: r.roofElevationM,
      roofElevationMinM: r.roofElevationMinM,
      roofElevationMedianM: r.roofElevationMedianM,
      roofElevationMaxM: r.roofElevationMaxM,
      buildingHeightM: r.buildingHeightM,
      heightMethod: r.heightMethod,
      heightStatistic: r.heightStatistic,
      sampleCounts: r.sampleCounts,
      coverageRatio: r.coverageRatio,
      footprintBufferM: r.footprintBufferM,
      crsStatus: r.crsStatus,
      qualityStatus: r.qualityStatus,
      qualityIssues: r.qualityIssues,
      confidenceLevel: r.confidenceLevel,
      confidenceScore: r.confidenceScore,
      dataSource: r.dataSource,
      groundClassificationMethod: r.groundClassificationMethod,
      existingHeightM: existing?.heightM ?? null,
      existingHeightSource: existing ? (existing.elevationOverrideActive ? existing.elevationSource : 'DEMO_ESTIMATED') : null,
      appliedToBuilding: false,
      reviewStatus: 'REVIEW_REQUIRED',
      source: out.source || 'ELEVATION_DEMO',
      provenance: out.provenance,
      timestamp: now,
      isDemo: true,
      disclaimer: AI_ELEVATION_DISCLAIMER,
    }
    await db.collection('buildingHeights').create(doc)
    stored.push(doc)
  }

  const summary = out.summary || {}
  await db.collection('aiJobs').updateOne({ jobId: jid }, {
    status: 'COMPLETED', completedAt: new Date().toISOString(), summary,
    crsComparison: out.crsComparison, groundClassificationMethod: out.groundClassificationMethod,
  })

  return {
    jobId: jid,
    status: 'COMPLETED',
    datasets: out.datasets,
    crsComparison: out.crsComparison,
    groundClassificationMethod: out.groundClassificationMethod,
    provenance: out.provenance,
    buildings: stored,
    summary,
    notes: out.notes || [],
    disclaimer: AI_ELEVATION_DISCLAIMER,
  }
}
