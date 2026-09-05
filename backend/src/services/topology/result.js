// Finding/result-shape builder for the topology validation engine (Phase 7).
// Every finding has the same extensible shape regardless of which rule module
// produced it, per the spec's result model.

import { defaultsFor, RULE_ALIASES, STATUS, worstSeverity, worstStatus } from './severity.js'

let seq = Date.now() % 1_000_000
const nextValidationId = () => {
  seq += 1
  return `TFIND-${Date.now().toString(36).toUpperCase()}-${String(seq).padStart(6, '0')}`
}

/**
 * Build one deterministic finding. Only `ruleId`, `entityType`, `entityId`
 * and `message` are required — everything else is optional and simply
 * omitted (never fabricated) when not applicable to that rule.
 *
 * @param {object} f
 * @param {string} f.ruleId
 * @param {'VALID'|'WARNING'|'ERROR'|'REVIEW_REQUIRED'} [f.status] defaults from RULE_DEFAULTS
 * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} [f.severity] defaults from RULE_DEFAULTS
 * @param {'PARCEL'|'BUILDING'|'FLOOR'|'UNIT'|'VOLUME'} f.entityType
 * @param {string} f.entityId
 * @param {string} [f.parentEntityId]
 * @param {string} [f.relatedEntityId]
 * @param {string} f.message
 * @param {object} [f.geometry] compact GeoJSON/bbox reference, never the full source dataset
 * @param {{kind:string, ulpin?:string, buildingId?:string, floorNumber?:number, propertyId?:string}} [f.focusRef] how the frontend re-selects this entity in the existing Cesium viewer
 * @param {object} [f.relatedFocusRef] same shape as focusRef, for `relatedEntityId` — lets the UI focus BOTH sides of a relationship finding (e.g. UNIT_OVERLAP's two units, BUILDING_OUTSIDE_PARCEL's building + parcel)
 * @param {string} [f.suggestedFix] guidance only — never applied automatically
 * @param {number} [f.computedValue]
 * @param {number} [f.tolerance]
 * @param {string} [f.provenance] the underlying entity's own provenance/source — never upgraded
 * @param {string} [f.locality]
 */
export function makeFinding(f) {
  const d = defaultsFor(f.ruleId)
  return {
    validationId: nextValidationId(),
    ruleId: f.ruleId,
    aliases: RULE_ALIASES[f.ruleId] || [],
    status: f.status || d.status,
    severity: f.severity || d.severity,
    entityType: f.entityType,
    entityId: f.entityId,
    parentEntityId: f.parentEntityId ?? null,
    relatedEntityId: f.relatedEntityId ?? null,
    message: f.message,
    geometry: f.geometry ?? null,
    focusRef: f.focusRef ?? null,
    relatedFocusRef: f.relatedFocusRef ?? null,
    suggestedFix: f.suggestedFix ?? null,
    computedValue: Number.isFinite(f.computedValue) ? f.computedValue : null,
    tolerance: Number.isFinite(f.tolerance) ? f.tolerance : null,
    provenance: f.provenance ?? null,
    locality: f.locality ?? null,
    createdAt: new Date().toISOString(),
  }
}

const ENTITY_TYPES = ['PARCEL', 'BUILDING', 'FLOOR', 'UNIT', 'VOLUME']
const emptyBucket = () => ({ total: 0, valid: 0, warning: 0, error: 0, reviewRequired: 0 })

/**
 * Aggregate a flat findings array into the spec's summary shape.
 *
 * No rule module ever emits a "VALID" finding for a clean entity (the same
 * convention Phase 2/6 already use — an issues array only ever contains
 * problems). So `valid` per entity type is `entityCounts[type] minus the
 * number of DISTINCT entities of that type with at least one finding` — not
 * a count of findings whose status happens to be VALID. `entityCounts` must
 * therefore be the count of entities actually examined in this run, even
 * ones with zero findings.
 *
 * @param {object[]} findings
 * @param {{PARCEL?:number, BUILDING?:number, FLOOR?:number, UNIT?:number, VOLUME?:number}} entityCounts
 */
export function summarize(findings, entityCounts = {}) {
  const byEntity = Object.fromEntries(ENTITY_TYPES.map((t) => [t, emptyBucket()]))
  const byRule = {}
  const worstByEntityId = new Map() // `${entityType}:${entityId}` -> worst status

  for (const f of findings) {
    const key = `${f.entityType}:${f.entityId}`
    worstByEntityId.set(key, worstStatus(worstByEntityId.get(key) || STATUS.VALID, f.status))

    if (!byRule[f.ruleId]) byRule[f.ruleId] = { ruleId: f.ruleId, total: 0, warning: 0, error: 0, reviewRequired: 0 }
    byRule[f.ruleId].total += 1
    if (f.status === STATUS.WARNING) byRule[f.ruleId].warning += 1
    else if (f.status === STATUS.ERROR) byRule[f.ruleId].error += 1
    else if (f.status === STATUS.REVIEW_REQUIRED) byRule[f.ruleId].reviewRequired += 1
  }

  for (const [key, status] of worstByEntityId) {
    const entityType = key.slice(0, key.indexOf(':'))
    const bucket = byEntity[entityType]
    if (!bucket) continue
    if (status === STATUS.WARNING) bucket.warning += 1
    else if (status === STATUS.ERROR) bucket.error += 1
    else if (status === STATUS.REVIEW_REQUIRED) bucket.reviewRequired += 1
  }

  for (const type of ENTITY_TYPES) {
    const bucket = byEntity[type]
    const examined = entityCounts[type] ?? (bucket.warning + bucket.error + bucket.reviewRequired)
    bucket.total = examined
    bucket.valid = Math.max(0, examined - bucket.warning - bucket.error - bucket.reviewRequired)
  }

  const total = ENTITY_TYPES.reduce((acc, t) => {
    acc.total += byEntity[t].total
    acc.valid += byEntity[t].valid
    acc.warning += byEntity[t].warning
    acc.error += byEntity[t].error
    acc.reviewRequired += byEntity[t].reviewRequired
    return acc
  }, emptyBucket())

  const overallStatus = findings.reduce((s, f) => worstStatus(s, f.status), STATUS.VALID)
  const overallSeverity = findings
    .filter((f) => f.status !== STATUS.VALID)
    .reduce((s, f) => (s ? worstSeverity(s, f.severity) : f.severity), null)

  return { ...total, overallStatus, overallSeverity, byEntity, byRule }
}

export { nextValidationId }
