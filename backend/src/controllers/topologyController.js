// Phase 7 — intelligent 2D/3D topology validation engine API (additive).
//
// Every response is explicit about being RULE_ENGINE / DETERMINISTIC_VALIDATION
// output (isOfficial: false, TOPOLOGY_DISCLAIMER) — never AI/ML, and never a
// modification of the underlying parcel/building/floor/unit geometry. Runs
// live in their own `topologyValidationResults` collection.

import { db } from '../store/index.js'
import { asyncHandler, ok, list, badRequest, notFoundError } from '../utils/http.js'
import { runValidation, topologyEngineConfig, TOPOLOGY_CONFIG, TOPOLOGY_DISCLAIMER, ML_DECISION_NOTE, ruleMatches } from '../services/topology/index.js'
import { STATUS } from '../services/topology/severity.js'

const publicDoc = (d) => {
  if (!d) return d
  const { _id, ...rest } = d
  return rest
}

export const getConfig = asyncHandler(async (req, res) => {
  const py = await topologyEngineConfig()
  ok(res, {
    tolerances: TOPOLOGY_CONFIG,
    geometryEngine: py, // null if the ai-service is unreachable — never fabricated
    mlDecision: ML_DECISION_NOTE,
    disclaimer: TOPOLOGY_DISCLAIMER,
  })
})

function filterFindings(findings, { entity, status, severity, rule }) {
  return findings.filter((f) => (
    (!entity || f.entityType === entity)
    && (!status || f.status === status)
    && (!severity || f.severity === severity)
    && ruleMatches(f.ruleId, rule)
  ))
}

const runResponse = (doc, req) => {
  const { entity, status, severity, rule } = req.query
  const findings = filterFindings(doc.findings, { entity, status, severity, rule })
  return { ...publicDoc(doc), findings, findingCount: findings.length }
}

export const validateAll = asyncHandler(async (req, res) => {
  const doc = await runValidation({ scopeType: 'all' }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const validateArea = asyncHandler(async (req, res) => {
  const { areaId } = req.params
  const doc = await runValidation({ scopeType: 'area', scopeId: areaId, localities: [areaId] }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const validateParcel = asyncHandler(async (req, res) => {
  const { ulpin } = req.params
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) throw notFoundError(`No parcel ${ulpin}`)
  const doc = await runValidation({ scopeType: 'parcel', scopeId: ulpin }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const validateBuilding = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) throw notFoundError(`No building ${buildingId}`)
  const doc = await runValidation({ scopeType: 'building', scopeId: buildingId }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const validateFloor = asyncHandler(async (req, res) => {
  const { floorId } = req.params
  const floor = await db.collection('floors').findOne({ floorId })
  if (!floor) throw notFoundError(`No floor ${floorId}`)
  const doc = await runValidation({ scopeType: 'floor', scopeId: floorId }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const validateUnit = asyncHandler(async (req, res) => {
  const { propertyId } = req.params
  const unit = await db.collection('propertyUnits').findOne({ propertyId })
  if (!unit) throw notFoundError(`No unit ${propertyId}`)
  const doc = await runValidation({ scopeType: 'unit', scopeId: propertyId }, { user: req.user })
  ok(res, runResponse(doc, req))
})

export const listResults = asyncHandler(async (req, res) => {
  const { scopeType, limit } = req.query
  const filter = {}
  if (scopeType) filter.scopeType = scopeType
  const rows = await db.collection('topologyValidationResults').find(filter, {
    sort: { createdAt: -1 }, limit: limit ? Number(limit) : 20,
    projection: { findings: 0 }, // list is a summary index — fetch one run by id for full findings
  })
  list(res, rows.map(publicDoc), { total: await db.collection('topologyValidationResults').count(filter), disclaimer: TOPOLOGY_DISCLAIMER })
})

export const getResult = asyncHandler(async (req, res) => {
  const row = await db.collection('topologyValidationResults').findOne({ validationRunId: req.params.id })
  if (!row) throw notFoundError(`No topology validation run ${req.params.id}`)
  ok(res, runResponse(row, req))
})

export const getLatestSummary = asyncHandler(async (req, res) => {
  const { scopeType } = req.query
  const filter = scopeType ? { scopeType } : {}
  const [row] = await db.collection('topologyValidationResults').find(filter, { sort: { createdAt: -1 }, limit: 1 })
  if (!row) return ok(res, { summary: null, disclaimer: TOPOLOGY_DISCLAIMER })
  ok(res, { validationRunId: row.validationRunId, scopeType: row.scopeType, scopeId: row.scopeId, createdAt: row.createdAt, summary: row.summary, disclaimer: TOPOLOGY_DISCLAIMER })
})

const REVIEW_ACTIONS = ['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']

// A lightweight review action — marks one finding within a stored run as
// reviewed. This NEVER touches parcel/building/floor/unit geometry; it only
// records that a reviewer looked at the finding.
export const reviewFinding = asyncHandler(async (req, res) => {
  const { id, validationId } = req.params
  const action = String(req.body?.action || '').toUpperCase()
  if (!REVIEW_ACTIONS.includes(action)) throw badRequest(`action must be one of ${REVIEW_ACTIONS.join(', ')}`)
  const run = await db.collection('topologyValidationResults').findOne({ validationRunId: id })
  if (!run) throw notFoundError(`No topology validation run ${id}`)
  const idx = run.findings.findIndex((f) => f.validationId === validationId)
  if (idx === -1) throw notFoundError(`No finding ${validationId} in run ${id}`)

  const findings = [...run.findings]
  findings[idx] = {
    ...findings[idx],
    reviewAction: action,
    reviewedBy: req.user?.username || null,
    reviewedAt: new Date().toISOString(),
    status: action === 'RESOLVED' && findings[idx].status !== STATUS.VALID ? STATUS.REVIEW_REQUIRED : findings[idx].status,
  }
  const updated = await db.collection('topologyValidationResults').updateOne({ validationRunId: id }, { findings })
  ok(res, runResponse(updated, req))
})
