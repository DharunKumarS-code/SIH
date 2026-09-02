import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export const hashPassword = (plain) => bcrypt.hash(plain, 10)
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

export function signToken(user) {
  return jwt.sign(
    { sub: user.id || user.username, username: user.username, role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  )
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret)
}

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  email: u.email,
  role: u.role,
})
