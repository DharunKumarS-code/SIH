import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Eye, EyeOff, LogIn, Landmark, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { APP_DISCLAIMER } from '../lib/constants.js'
import { DemoTag } from '../components/ui/primitives.jsx'

const CESIUM_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN
const REMEMBER_KEY = 'ulpin_remember_username'

// Slowly-rotating Cesium globe used only as a decorative login backdrop —
// camera input is disabled so it never behaves like an interactive map.
function SpinningGlobeBackground() {
  const hostRef = useRef(null)

  useEffect(() => {
    if (!CESIUM_TOKEN || !hostRef.current) return undefined
    let viewer = null
    let cancelled = false
    let onTick = null

    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN

    try {
      viewer = new Cesium.Viewer(hostRef.current, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        timeline: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
      })
    } catch {
      return undefined
    }
    if (cancelled) {
      viewer.destroy()
      return undefined
    }

    viewer.scene.screenSpaceCameraController.enableInputs = false
    viewer.scene.globe.enableLighting = false
    viewer.scene.moon.show = false

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(80.27, 13.08, 24000000),
    })

    onTick = () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00035)
      }
    }
    viewer.clock.onTick.addEventListener(onTick)

    return () => {
      cancelled = true
      if (viewer && !viewer.isDestroyed()) {
        if (onTick) viewer.clock.onTick.removeEventListener(onTick)
        viewer.destroy()
      }
    }
  }, [])

  return <div ref={hostRef} className="absolute inset-0 h-full w-full bg-slate-950" aria-hidden="true" />
}

export default function Login() {
  const { login, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: 'land01', password: 'Officer@123' })
  const [demoAccounts, setDemoAccounts] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    api.demoCredentials().then((d) => setDemoAccounts(d.accounts || [])).catch(() => {})
    try {
      const saved = localStorage.getItem(REMEMBER_KEY)
      if (saved) {
        setForm((f) => ({ ...f, username: saved }))
        setRemember(true)
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [])

  if (!loading && isAuthenticated) return <Navigate to="/dashboard" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const username = form.username.trim()
      await login(username, form.password)
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, username)
        else localStorage.removeItem(REMEMBER_KEY)
      } catch {
        /* localStorage unavailable */
      }
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <SpinningGlobeBackground />
      {/* Only darken toward the card's side so the globe stays visible behind it — the
          card's own backdrop-blur then picks up the globe's colors for the glass look. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-slate-950/10 to-slate-950/60 lg:from-transparent lg:via-slate-950/5 lg:to-slate-950/55" />

      <div className="absolute left-6 top-6 z-10 flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-white/10 text-white backdrop-blur">
          <Landmark size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
            Government · Land Governance Portal
          </div>
          <div className="text-sm font-extrabold tracking-tight text-white">PROPERTY 3D ULPIN</div>
        </div>
      </div>

      <div className="relative z-10 flex h-full items-center justify-center px-4 lg:justify-end lg:pr-20">
        <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-2xl">
          <h1 className="text-3xl font-extrabold text-white">Hello</h1>
          <p className="mt-1 text-sm text-white/70">Sign in with a prototype demo account.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
                Username
              </span>
              <input
                className="w-full border-b border-white/30 bg-transparent pb-2 text-sm text-white placeholder-white/40 outline-none transition focus:border-white"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                data-testid="login-username"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
                Password
              </span>
              <div className="relative">
                <input
                  className="w-full border-b border-white/30 bg-transparent pb-2 pr-8 text-sm text-white placeholder-white/40 outline-none transition focus:border-white"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="current-password"
                  data-testid="login-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-0 top-0 text-white/60 transition hover:text-white"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="flex items-center justify-between text-xs text-white/60">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/40 bg-transparent accent-primary"
                />
                Remember me
              </label>
              <span className="cursor-not-allowed" title="Not available in this prototype">
                Forgot your password?
              </span>
            </div>

            {error && (
              <p className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                {error}
              </p>
            )}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-2.5 text-sm font-bold text-slate-900 transition hover:bg-white/90 disabled:opacity-60"
              disabled={busy}
              data-testid="login-submit"
            >
              <LogIn size={16} />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-wide text-white/40">
            <div className="h-px flex-1 bg-white/15" /> Or login with <div className="h-px flex-1 bg-white/15" />
          </div>

          <div className="mt-4 flex items-center justify-center gap-4">
            {['Google', 'Facebook', 'Apple'].map((name) => (
              <button
                key={name}
                type="button"
                disabled
                title={`${name} sign-in is not available in this prototype`}
                className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-full border border-white/20 bg-white/5 text-xs font-bold text-white/50"
              >
                {name[0]}
              </button>
            ))}
          </div>

          {demoAccounts.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                Demo accounts <DemoTag />
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {demoAccounts.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    onClick={() => setForm({ username: a.username, password: a.password })}
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-left text-[11px] transition hover:bg-white/15"
                  >
                    <span className="block font-semibold text-white">{a.role}</span>
                    <span className="block text-white/50">{a.username}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-6 flex items-start gap-1.5 text-[10px] leading-relaxed text-white/40">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" /> {APP_DISCLAIMER}
          </p>
        </div>
      </div>
    </div>
  )
}
