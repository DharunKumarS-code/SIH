import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { ShieldCheck, LogIn } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { APP_DISCLAIMER } from '../lib/constants.js'
import { DemoTag } from '../components/ui/primitives.jsx'

export default function Login() {
  const { login, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: 'land01', password: 'Officer@123' })
  const [demoAccounts, setDemoAccounts] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.demoCredentials().then((d) => setDemoAccounts(d.accounts || [])).catch(() => {})
  }, [])

  if (!loading && isAuthenticated) return <Navigate to="/dashboard" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(form.username.trim(), form.password)
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-navy-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_10%_-10%,rgba(47,111,235,0.25),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded bg-primary text-lg font-black text-white">LS</div>
            <div>
              <div className="text-lg font-extrabold tracking-tight text-white">LAND STACK</div>
              <div className="text-xs text-slate-400">Digital Public Infrastructure for Land Governance</div>
            </div>
          </div>
          <div className="max-w-md">
            <h1 className="text-3xl font-extrabold leading-tight text-white">
              A parcel-centric Land Stack, extended into <span className="text-cyan">3D property intelligence</span>.
            </h1>
            <p className="mt-4 text-sm text-slate-400">
              Land parcels, buildings, floors and individual apartment units — independently identified,
              visualised in 3D and governed through one interoperable record.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck size={14} /> Prototype · Chennai (OMR / Sholinganallur) · Synthetic demo data
            </div>
          </div>
          <p className="max-w-md text-[11px] leading-relaxed text-slate-500">{APP_DISCLAIMER}</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-extrabold text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-400">Use a prototype demo account.</p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-400">Username</span>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                data-testid="login-username"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-400">Password</span>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                autoComplete="current-password"
                data-testid="login-password"
                required
              />
            </label>

            {error && (
              <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <button className="btn-primary w-full justify-center" disabled={busy} data-testid="login-submit">
              <LogIn size={16} />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {demoAccounts.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-2 section-title">
                Demo accounts <DemoTag />
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {demoAccounts.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    onClick={() => setForm({ username: a.username, password: a.password })}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-left text-[11px] hover:bg-white/10"
                  >
                    <span className="block font-semibold text-slate-200">{a.role}</span>
                    <span className="block text-slate-500">{a.username}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
