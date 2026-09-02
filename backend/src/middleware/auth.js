import { verifyToken } from '../services/authService.js'
import { unauthorized, forbidden } from '../utils/http.js'
import { can } from '../config/rbac.js'
import { db } from '../store/index.js'

/** Populate req.user from a Bearer token; 401 if missing/invalid. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw unauthorized()
    const payload = verifyToken(token)
    const user = await db.collection('users').findOne({ username: payload.username })
    if (!user) throw unauthorized('Account no longer exists')
    req.user = { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email }
    next()
  } catch (err) {
    next(err.status ? err : unauthorized('Invalid or expired token'))
  }
}

/** Optional auth — attaches req.user if a valid token is present, else continues. */
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return next()
  try {
    const payload = verifyToken(header.slice(7))
    const user = await db.collection('users').findOne({ username: payload.username })
    if (user) req.user = { id: user.id, username: user.username, name: user.name, role: user.role }
  } catch {
    /* ignore — treat as anonymous */
  }
  next()
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`))
    }
    next()
  }

export const requirePermission =
  (permission) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    if (!can(req.user.role, permission)) {
      return next(forbidden(`Missing permission: ${permission}`))
    }
    next()
  }
