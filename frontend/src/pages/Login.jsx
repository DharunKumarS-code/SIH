import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { ShieldCheck, LogIn, Landmark } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { APP_DISCLAIMER } from '../lib/constants.js'

// This page keeps a fixed dark "space" identity regardless of the app-wide
// light/dark toggle (that toggle only governs the authenticated app shell,
// mounted after sign-in) — so every color here is a literal value, never a
// theme-reactive token class (slate-*, primary, teal, brass, surface, ...),
// which would otherwise flip unexpectedly if the visitor's last saved
// preference happens to be dark and wash text out against this always-dark
// background.
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
    <div className="relative h-full overflow-y-auto overflow-x-hidden bg-[#0a121f] text-white">
      {/* BACKGROUND LAYER (z-0) — fixed to the viewport, never scrolls with
          content: faint starfield, the large half-Earth photo (see
          public/planet-earth-background.jpg — the exact supplied image, used
          flat, never reprojected onto a sphere), a thin colour wash, then a
          top-weighted readability gradient so the foreground text/card stay
          legible over it. Purely decorative; this never touches the Cesium
          map. */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(1px 1px at 15% 20%, rgba(255,255,255,0.7) 1px, transparent 0),' +
              'radial-gradient(1px 1px at 75% 12%, rgba(255,255,255,0.5) 1px, transparent 0),' +
              'radial-gradient(1.5px 1.5px at 40% 65%, rgba(255,255,255,0.6) 1px, transparent 0),' +
              'radial-gradient(1px 1px at 92% 45%, rgba(255,255,255,0.45) 1px, transparent 0),' +
              'radial-gradient(1px 1px at 60% 85%, rgba(255,255,255,0.5) 1px, transparent 0),' +
              'radial-gradient(1.5px 1.5px at 10% 78%, rgba(255,255,255,0.4) 1px, transparent 0)',
            backgroundSize: '520px 520px',
            backgroundRepeat: 'repeat',
          }}
        />
        {/* soft glow behind the Earth so it integrates with the space
            background instead of having a hard rectangular edge. Centred on
            the same point as the Earth image below: left-of-centre and
            vertically centred on the hero area (branding-to-footer band),
            so the Earth reads as a left/centre background element the
            headline sits above rather than sitting too low near the footer.
            The offset only applies at `lg:`, where the two-column layout
            exists; below it the content stacks to a single column, so the
            Earth stays plain viewport-centred. Sized wider than the image
            box itself so it extends past the masked photo's fade zone,
            smoothing the hand-off between the photo and the plain
            background rather than ending at the same boundary. */}
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(62,190,172,0.16),transparent_72%)] lg:left-[30%] lg:top-[57%]" />
        {/* `perspective` lives on this wrapper (not the <img>) so the child's
            rotateX below gets real 3D foreshortening instead of a flat skew.
            The image itself is never reprojected onto geometry — it is
            always the flat supplied photo, just tilted a few degrees.
            Positioned left-of-centre and vertically centred on the hero area
            (only from `lg:` up — below that the content stacks to one
            column, so the Earth stays viewport-centred). The image's own
            bright band sits in its lower half (the top is empty starfield),
            so centring the box this way still keeps the headline reading
            above the Earth's visible bright content. Top offset (57% vs the
            photo's old 60%) and a slightly shorter max-height keep the
            disc's dark lower edge clear of the footer row instead of
            running underneath it. */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-[30%] lg:top-[57%]"
          style={{
            width: 'clamp(560px, 60vw, 1280px)',
            maxWidth: '88vw',
            maxHeight: '64vh',
            aspectRatio: '4556 / 3000',
            perspective: '1400px',
          }}
        >
          {/* the mask (see .earth-mask, index.css) feathers the photo's own
              rectangular edges to transparent so no image boundary is ever
              visible — only the earth disc and its glow read as content. */}
          <img
            src="/planet-earth-background.jpg"
            alt=""
            className="earth-roll earth-mask h-full w-full object-contain"
          />
        </div>
        {/* readability scrims. The top pair dim the branding/headline band
            near the top of the page; the left-edge gradient below runs the
            full page height so the headline/description/metadata stay
            legible against the Earth no matter how tall the left content
            block is, without ever becoming an opaque block. Below `lg:` the
            content stacks full-width (no separate "left column"), so the
            gradient spans the full width there; from `lg:` up it narrows to
            just the left column's side, fading to fully transparent well
            before the Earth/gap/login-card area. */}
        <div className="absolute inset-x-0 top-0 h-[38vh] bg-[radial-gradient(ellipse_75%_100%_at_35%_0%,rgba(10,18,31,0.9),transparent_75%)]" />
        <div className="absolute inset-x-0 top-0 h-[45vh] bg-[radial-gradient(ellipse_65%_55%_at_50%_0%,rgba(20,67,130,0.14),transparent_70%)]" />
        <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-[#0a121f]/75 via-[#0a121f]/25 to-transparent lg:w-[46%]" />
        {/* bottom scrim — the Earth now sits lower on the page (pushed down
            so the headline reads above its bright band), so its lower edge
            reaches into the footer/disclaimer row; this keeps that text
            legible without dimming the Earth's main body above it. */}
        <div className="absolute inset-x-0 bottom-0 h-[20vh] bg-gradient-to-t from-[#0a121f]/90 to-transparent" />
      </div>

      {/* FOREGROUND CONTENT (z-10) */}
      <div className="relative z-10 mx-auto flex h-full min-h-full w-full max-w-6xl flex-col px-6 pt-6 lg:px-10 lg:pt-8">
        {/* branding — same navy masthead mark used in the authenticated
            app's top bar, for continuity across the sign-in boundary. */}
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-[#6a9ce0]/40 bg-[#6a9ce0]/15 text-[#8fb6e8] shadow-[0_0_22px_rgba(106,156,224,0.25)]">
            <Landmark size={19} />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Government · Land Governance Portal</div>
            <div className="font-display text-lg font-semibold tracking-tight text-white">PROPERTY 3D ULPIN</div>
            <div className="text-xs text-white/45">Chennai 3D Cadastre</div>
          </div>
        </div>

        {/* headline + login card — centred in the space between branding and
            footer so the pair floats over the background Earth */}
        <div className="flex flex-1 flex-col justify-center py-6">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div className="relative max-w-xl">
            {/* localized, non-rectangular scrim: only this radial blob (not
                an opaque panel) sits between the text and the earth photo,
                so the paragraph stays readable over the bright cloud band
                without ever reading as a card. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-8 -inset-y-6 -z-10"
              style={{
                background:
                  'radial-gradient(ellipse 80% 78% at 32% 42%, rgba(10,18,31,0.6), rgba(10,18,31,0.3) 55%, transparent 82%)',
              }}
            />
            <div className="flex flex-col items-start gap-5">
              <h1 className="max-w-lg font-display text-3xl font-semibold leading-tight text-white sm:text-4xl lg:whitespace-nowrap">
                Parcel-centric land governance,
                <br />
                extended into{' '}
                <span className="text-[#3ebeac]">3D property</span>
                <br />
                <span className="text-[#3ebeac]">intelligence.</span>
              </h1>
              <p className="max-w-sm text-sm leading-relaxed text-white/70 sm:text-base">
                Land parcels, buildings, floors and individual apartment units — independently identified,
                validated in 3D and governed through one interoperable record.
              </p>
              <div className="flex items-start gap-2 text-xs text-[#d99142]">
                <ShieldCheck size={14} className="mt-[1px] shrink-0" />
                <span>Prototype · Chennai (Sholinganallur / Adyar / Anna Nagar) · Synthetic demo data</span>
              </div>
            </div>
          </div>

          {/* sign-in card — unchanged auth logic; liquid-glass presentation */}
          <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-[#3ebeac]/25 bg-[#101b2c]/55 p-6 shadow-[0_8px_50px_rgba(3,8,20,0.55),0_0_90px_-10px_rgba(62,190,172,0.2)] backdrop-blur-xl lg:justify-self-end">
            {/* glass highlights — decorative only, sit behind the z-10 content below */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.07] via-transparent to-transparent" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#3ebeac]/50 to-transparent" aria-hidden="true" />

            <div className="relative z-10">
              <h2 className="font-display text-xl font-semibold text-white">Sign in</h2>
              <p className="mt-1 text-sm text-white/60">Use a prototype demo account.</p>

              <form onSubmit={submit} className="mt-6 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-white/60">Username</span>
                  <input
                    className="w-full rounded-md border border-white/15 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/30 backdrop-blur-sm transition-colors focus:border-[#3ebeac]/60 focus:outline-none focus:ring-2 focus:ring-[#3ebeac]/50"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    autoComplete="username"
                    data-testid="login-username"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-white/60">Password</span>
                  <input
                    className="w-full rounded-md border border-white/15 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/30 backdrop-blur-sm transition-colors focus:border-[#3ebeac]/60 focus:outline-none focus:ring-2 focus:ring-[#3ebeac]/50"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="current-password"
                    data-testid="login-password"
                    required
                  />
                </label>

                {error && (
                  <p className="rounded-md border border-[#e06464]/30 bg-[#e06464]/10 px-3 py-2 text-sm text-[#e06464]" role="alert">
                    {error}
                  </p>
                )}

                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#3ebeac] px-3 py-1.5 text-sm font-semibold text-[#0a121f] transition-colors hover:bg-[#5bd0bf] disabled:opacity-50"
                  disabled={busy}
                  data-testid="login-submit"
                >
                  <LogIn size={16} />
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              {demoAccounts.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50">
                    Demo accounts{' '}
                    <span className="inline-flex items-center rounded border border-[#d99142]/35 bg-[#d99142]/10 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#d99142]">
                      DEMO
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {demoAccounts.map((a) => (
                      <button
                        key={a.username}
                        type="button"
                        onClick={() => setForm({ username: a.username, password: a.password })}
                        className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.12]"
                      >
                        <span className="block font-semibold text-white">{a.role}</span>
                        <span className="data-mono block text-white/50">{a.username}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        <p className="relative mx-auto max-w-3xl pb-4 text-center text-[11px] leading-relaxed text-white/40">
          {APP_DISCLAIMER}
        </p>
      </div>
    </div>
  )
}
