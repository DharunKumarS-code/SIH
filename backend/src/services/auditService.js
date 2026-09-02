import { db } from '../store/index.js'

let counter = 1000

/**
 * Append an audit-trail entry. Never throws into the request path.
 * @param {object} entry { user, action, entityType, entityId, before, after, ip }
 */
export async function recordAudit(entry) {
  try {
    const row = {
      logId: `AUD-${String(++counter).padStart(4, '0')}`,
      at: new Date().toISOString(),
      user: entry.user || 'anonymous',
      action: entry.action,
      entityType: entry.entityType || null,
      entityId: entry.entityId || null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip || null,
    }
    await db.collection('auditLogs').create(row)
    return row
  } catch (err) {
    console.warn('[audit] failed to record entry:', err.message)
    return null
  }
}

/** Express helper: fire an audit entry after a successful mutating response. */
export const auditAction = (action, entityType, getEntityId) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400) {
      recordAudit({
        user: req.user?.username,
        action,
        entityType,
        entityId: typeof getEntityId === 'function' ? getEntityId(req, res) : req.params.id,
        ip: req.ip,
      })
    }
  })
  next()
}
