import { z } from 'zod'
import { db } from '../store/index.js'
import { asyncHandler, ok, badRequest, unauthorized } from '../utils/http.js'
import { hashPassword, verifyPassword, signToken, publicUser } from '../services/authService.js'
import { permissionsFor, ROLES } from '../config/rbac.js'
import { recordAudit } from '../services/auditService.js'

export const registerSchema = {
  body: z.object({
    username: z.string().min(3).max(40),
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(6).max(100),
    role: z.enum(ROLES).default('Citizen'),
  }),
}

export const loginSchema = {
  body: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
}

export const register = asyncHandler(async (req, res) => {
  const { username, name, email, password, role } = req.body
  const existing = await db.collection('users').findOne({ username })
  if (existing) throw badRequest('Username already taken')
  const id = `usr-${Date.now().toString(36)}`
  const user = {
    id,
    username,
    name,
    email,
    role,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  }
  await db.collection('users').create(user)
  await recordAudit({ user: username, action: 'USER_REGISTERED', entityType: 'User', entityId: id, ip: req.ip })
  const token = signToken(user)
  ok(res, { token, user: publicUser(user), permissions: permissionsFor(role) })
})

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body
  const user = await db.collection('users').findOne({ username })
  if (!user) throw unauthorized('Invalid credentials')
  const good = await verifyPassword(password, user.passwordHash)
  if (!good) throw unauthorized('Invalid credentials')
  await recordAudit({ user: username, action: 'USER_LOGIN', entityType: 'User', entityId: user.id, ip: req.ip })
  const token = signToken(user)
  ok(res, { token, user: publicUser(user), permissions: permissionsFor(user.role) })
})

export const me = asyncHandler(async (req, res) => {
  const user = await db.collection('users').findOne({ username: req.user.username })
  ok(res, { user: publicUser(user), permissions: permissionsFor(user.role) })
})
