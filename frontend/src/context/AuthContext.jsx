import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { api, setAuthToken } from '../lib/api.js'
import { permissionsFor } from '../lib/permissions.js'

const AuthContext = createContext(null)

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(payload)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    let token = null
    try {
      token = localStorage.getItem('landstack.token')
    } catch {
      /* storage unavailable */
    }
    if (!token) {
      setLoading(false)
      return () => {
        alive = false
      }
    }

    // Optimistic session from the token payload so a reload renders the app
    // immediately; the backend still enforces auth on every request.
    const claims = decodeJwt(token)
    if (claims && alive) {
      setUser({ id: claims.sub, username: claims.username, name: claims.name, role: claims.role })
      setPermissions(permissionsFor(claims.role))
      setLoading(false)
    }

    // Refresh from the server (and retry through transient blips). A real 401
    // is the only thing that ends the session.
    ;(async () => {
      for (let attempt = 0; attempt < 5 && alive; attempt += 1) {
        try {
          const { user: u, permissions: p } = await api.me()
          if (alive) {
            setUser(u)
            setPermissions(p)
          }
          return
        } catch (err) {
          if (err.status === 401) {
            if (alive) {
              setAuthToken(null)
              setUser(null)
              setPermissions([])
            }
            return
          }
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    })().finally(() => {
      if (alive && !claims) setLoading(false)
    })

    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const { token, user: u, permissions: p } = await api.login(username, password)
    setAuthToken(token)
    setUser(u)
    setPermissions(p)
    return u
  }, [])

  const logout = useCallback(() => {
    setAuthToken(null)
    setUser(null)
    setPermissions([])
  }, [])

  const can = useCallback(
    (perm) => permissions.includes('*') || permissions.includes(perm),
    [permissions],
  )

  const value = useMemo(
    () => ({ user, permissions, loading, login, logout, can, isAuthenticated: Boolean(user) }),
    [user, permissions, loading, login, logout, can],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
