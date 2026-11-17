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
  // Restore the session synchronously from the stored token so a reload
  // renders the app immediately (optimistic — the backend still enforces auth
  // on every request). Computed once as initial state, not set in an effect.
  const [initial] = useState(() => {
    let token = null
    try {
      token = localStorage.getItem('landstack.token')
    } catch {
      /* storage unavailable -> no session to restore */
    }
    return { token, claims: token ? decodeJwt(token) : null }
  })
  const { claims } = initial
  const [user, setUser] = useState(() =>
    claims ? { id: claims.sub, username: claims.username, name: claims.name, role: claims.role } : null,
  )
  const [permissions, setPermissions] = useState(() => (claims ? permissionsFor(claims.role) : []))
  // Only a token we could not decode needs to wait for /auth/me.
  const [loading, setLoading] = useState(Boolean(initial.token && !claims))

  useEffect(() => {
    let alive = true
    if (!initial.token) {
      return () => {
        alive = false
      }
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
  }, [initial.token, claims]) // both come from the one-time initial state -> runs once

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
