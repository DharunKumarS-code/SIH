// Phase 9 — geometry version store.
//
// A geometry version is a REFERENCE record, not a copy of geometry (spec
// section 41). It records the lifecycle of an entity's geometry over time:
//
//   { geometryVersionId, entityType, entityId, geometryVersion,
//     previousVersion, status, source, reason, provenance,
//     verificationStatus, isOfficial, geometryRef, createdBy, createdAt, updatedAt }
//
// RULES
//   - Historical versions are NEVER deleted or overwritten (spec sections 9-10).
//   - Once a version is finalized (ACTIVE / SUPERSEDED / ARCHIVED / REJECTED),
//     its geometry is immutable — a change creates a NEW version.
//   - Normally exactly ONE version is ACTIVE per logical entity at a time
//     (spec section 11); `assertSingleActive` enforces/validates this.
//   - Every transition is recorded via the existing audit service (spec §12) —
//     no parallel audit system.

import { db } from '../../store/index.js'
import { recordAudit } from '../auditService.js'

export const VERSION_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'ARCHIVED']
export const FINALIZED_STATUSES = new Set(['ACTIVE', 'SUPERSEDED', 'REJECTED', 'ARCHIVED'])

let seq = Date.now() % 100000
const nextVersionId = () => {
  seq += 1
  return `GVER-${String(seq).padStart(6, '0')}`
}

export const versionKey = (entityType, entityId) => `${String(entityType).toUpperCase()}:${entityId}`

/** All versions for one logical entity, oldest first. */
export async function listVersions(entityType, entityId) {
  const rows = await db.collection('geometryVersions').find(
    { entityType: String(entityType).toUpperCase(), entityId },
    { sort: { createdAt: 1 } },
  )
  return rows.map(({ _id, ...r }) => r)
}

export async function getVersion(entityType, entityId, geometryVersion) {
  const row = await db.collection('geometryVersions').findOne({
    entityType: String(entityType).toUpperCase(), entityId, geometryVersion,
  })
  if (!row) return null
  const { _id, ...r } = row
  return r
}

/** The single ACTIVE version for an entity, or null. */
export async function activeVersion(entityType, entityId) {
  const rows = await listVersions(entityType, entityId)
  return rows.find((r) => r.status === 'ACTIVE') || null
}

/**
 * Deterministic health check for the single-ACTIVE rule (spec section 11).
 * @returns {{ ok:boolean, activeCount:number, activeVersions:string[] }}
 */
export function assertSingleActive(rows) {
  const actives = rows.filter((r) => r.status === 'ACTIVE').map((r) => r.geometryVersion)
  return { ok: actives.length <= 1, activeCount: actives.length, activeVersions: actives }
}

/**
 * Create a new geometry version for an entity. If `makeActive` and an ACTIVE
 * version already exists, that version transitions to SUPERSEDED (never
 * deleted) and the new one becomes ACTIVE. Historical rows are preserved.
 */
export async function createVersion({
  entityType, entityId, source, reason, provenance, verificationStatus,
  geometryRef, status, makeActive = true, user,
}) {
  const etype = String(entityType).toUpperCase()
  const existing = await listVersions(etype, entityId)
  const prev = existing[existing.length - 1] || null
  const nextNum = existing.length + 1
  const geometryVersion = `v${nextNum}`
  const now = new Date().toISOString()

  const targetStatus = status || (makeActive ? 'ACTIVE' : 'DRAFT')

  // Supersede the current ACTIVE (immutably) if we are taking its place.
  if (targetStatus === 'ACTIVE') {
    const current = existing.find((r) => r.status === 'ACTIVE')
    if (current) {
      await db.collection('geometryVersions').updateOne(
        { geometryVersionId: current.geometryVersionId },
        { status: 'SUPERSEDED', supersededBy: geometryVersion, updatedAt: now },
      )
      await recordAudit({
        user: user?.username,
        action: 'GEOMETRY_VERSION_SUPERSEDED',
        entityType: `Geometry:${etype}`,
        entityId,
        before: { geometryVersion: current.geometryVersion, status: 'ACTIVE' },
        after: { geometryVersion: current.geometryVersion, status: 'SUPERSEDED', supersededBy: geometryVersion },
      })
    }
  }

  const doc = {
    geometryVersionId: nextVersionId(),
    entityType: etype,
    entityId,
    geometryVersion,
    previousVersion: prev ? prev.geometryVersion : null,
    status: targetStatus,
    source: source || 'DEMO',
    reason: reason || null,
    provenance: provenance || 'Application-generated geometry version reference',
    verificationStatus: verificationStatus || (source === 'AUTHORIZED' || source === 'OFFICIAL' ? source : 'DEMO'),
    isOfficial: source === 'AUTHORIZED' || source === 'OFFICIAL',
    geometryRef: geometryRef || { kind: etype, id: entityId }, // a reference, never a geometry copy
    createdBy: user?.username || null,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection('geometryVersions').create(doc)
  await recordAudit({
    user: user?.username,
    action: 'GEOMETRY_VERSION_CREATED',
    entityType: `Geometry:${etype}`,
    entityId,
    before: prev ? { geometryVersion: prev.geometryVersion, status: prev.status } : null,
    after: { geometryVersion, status: targetStatus, source: doc.source },
  })
  return doc
}

const TRANSITIONS = {
  DRAFT: ['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED'],
  PENDING_REVIEW: ['ACTIVE', 'REJECTED', 'DRAFT'],
  ACTIVE: ['SUPERSEDED', 'ARCHIVED'],
  SUPERSEDED: ['ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
}

/**
 * Transition a version's status (spec section 11). The geometry itself is
 * never modified here — finalized versions stay immutable.
 */
export async function transitionVersion({ entityType, entityId, geometryVersion, toStatus, reason, user }) {
  const etype = String(entityType).toUpperCase()
  const row = await getVersion(etype, entityId, geometryVersion)
  if (!row) return { ok: false, error: `No ${geometryVersion} for ${etype} ${entityId}` }
  const allowed = TRANSITIONS[row.status] || []
  if (!allowed.includes(toStatus)) {
    return { ok: false, error: `Illegal transition ${row.status} -> ${toStatus} (allowed: ${allowed.join(', ') || 'none'})` }
  }
  // Taking ACTIVE: only if nothing else is ACTIVE (or supersede it).
  if (toStatus === 'ACTIVE') {
    const current = await activeVersion(etype, entityId)
    if (current && current.geometryVersion !== geometryVersion) {
      await db.collection('geometryVersions').updateOne(
        { geometryVersionId: current.geometryVersionId },
        { status: 'SUPERSEDED', supersededBy: geometryVersion, updatedAt: new Date().toISOString() },
      )
    }
  }
  const now = new Date().toISOString()
  const updated = await db.collection('geometryVersions').updateOne(
    { geometryVersionId: row.geometryVersionId },
    { status: toStatus, transitionReason: reason || null, updatedAt: now },
  )
  await recordAudit({
    user: user?.username,
    action: 'GEOMETRY_VERSION_STATUS_CHANGED',
    entityType: `Geometry:${etype}`,
    entityId,
    before: { geometryVersion, status: row.status },
    after: { geometryVersion, status: toStatus, reason: reason || null },
  })
  const { _id, ...clean } = updated
  return { ok: true, version: clean }
}
