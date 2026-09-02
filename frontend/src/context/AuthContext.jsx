import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { api, setAuthToken } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const boot = async () => {
      let token = null
      try {
        token = localStorage.getItem('landstack.token')
      } catch {
        /* ignore */
      }
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const { user: u, permissions: p } = await api.me()
        if (alive) {
          setUser(u)
          setPermissions(p)
        }
      } catch {
        setAuthToken(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    boot()
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
