import { Suspense, lazy, useRef, useState } from 'react'
import { ArrowLeft, Box, Home, MapPin, MousePointer2, ShieldAlert, Video, X } from 'lucide-react'
import { COIMBATORE_DEMO_PROPERTY, COIMBATORE_CAMERA_PRESETS } from '../lib/constants.js'

const CoimbatorePropertyScene = lazy(() =>
  import('../components/explorer/CoimbatorePropertyScene.jsx').then((m) => ({ default: m.CoimbatorePropertyScene })),
)

// ---------------------------------------------------------------------------
// Coimbatore Demonstration Property — 3D Property Explorer, standalone tab,
// opened from the property sidebar's "Open 3D Property Explorer" link
// (/coimbatore-explorer). Same pattern as the existing /3d-explorer and
// /underground-explorer tabs: the Chennai-wide CesiumJS viewer stays the
// single geographic context; Three.js is used only here.
//
// ONE explorer, TWO modes of the same property (COIMBATORE-DEMO-001):
//   - Exterior (default): the actual ODM textured reconstruction.
//   - Interior: the actual Scaniverse scan from the grd-floor-viewer
//     reference repo.
// Neither model is fetched until its mode is actually selected — Exterior
// loads on open (as before), Interior only loads the first time the user
// clicks the Interior tab. See CoimbatorePropertyScene.jsx for the shared
// renderer/controls and per-mode loading/caching.
// ---------------------------------------------------------------------------

function Labelled({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-[12px] last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900 break-words">{children ?? '—'}</span>
    </div>
  )
}

// Interior keeps its original first-person legend. Exterior's camera is now
// an orbit camera (drag/scroll/presets), matching the 3D-ULPIN-Cadastre
// reference's interaction model — see CoimbatorePropertyScene.jsx.
const INTERIOR_CONTROLS = [
  { key: 'wasd', label: 'W A S D', desc: 'Move' },
  { key: 'mouse', label: 'MOUSE', desc: 'Look' },
  { key: 'shift', label: 'SHIFT', desc: 'Sprint' },
  { key: 'qe', label: 'Q / E', desc: 'Up / Down' },
  { key: 'esc', label: 'ESC', desc: 'Release mouse' },
]

const EXTERIOR_CONTROLS = [
  { key: 'drag', label: 'DRAG', desc: 'Orbit' },
  { key: 'scroll', label: 'SCROLL', desc: 'Zoom' },
  { key: 'rdrag', label: 'RIGHT-DRAG', desc: 'Pan' },
]

const MODES = [
  { key: 'exterior', label: 'Exterior' },
  { key: 'interior', label: 'Interior' },
]

const CAMERA_PRESET_KEYS = ['front', 'street', 'aerial', 'top']

const MODE_COPY = {
  exterior: {
    heading: 'ODM Textured Reconstruction',
    sizeLabel: 'ODM geometry (37 MB) and 21 textures (62 MB)',
    errorHint: 'Check that the ODM assets are present under /models/coimbatore-demo/ and reload.',
    provenance:
      'This is the actual user-provided ODM textured 3D reconstruction of the property exterior — a 2.5D draped mesh, not a closed volumetric building — staged inside a reproduced exterior environment (ground/road context, an illustrative cadastral parcel volume, illustrative underground utility routing). Parcel and utility geometry are illustrative only, not a surveyed cadastral boundary or a surveyed utility record.',
    footer: 'User-provided ODM 2.5D textured reconstruction · DEMO · not a surveyed cadastral volume',
  },
  interior: {
    heading: 'Interior Reference Scan',
    sizeLabel: 'interior scan geometry (~19 MB) and texture (~12 MB)',
    errorHint: 'Check that the interior assets are present under /models/coimbatore-demo/interior/ and reload.',
    provenance:
      'This is the actual Scaniverse interior scan sourced from the grd-floor-viewer reference repository. Its own capture metadata places it within ~15m of this property’s anchor. It uses its own independent transform — it is not reprojected into the exterior ODM’s coordinate frame.',
    footer: 'Reference interior scan (grd-floor-viewer) · DEMO · not a surveyed floor plan',
  },
}

export default function CoimbatoreExplorer3D() {
  const p = COIMBATORE_DEMO_PROPERTY
  const sceneRef = useRef(null)
  const [mode, setMode] = useState('exterior')
  const [locked, setLocked] = useState(false)
  const [status, setStatus] = useState('loading-materials') // loading-materials | loading-geometry | ready | error

  const copy = MODE_COPY[mode]

  const canClose = typeof window !== 'undefined' && window.opener && !window.opener.closed
  const returnToMap = () => {
    window.location.href = '/map'
  }

  const statusLabel = {
    'loading-materials': 'Loading materials…',
    'loading-geometry': `Loading ${copy.sizeLabel}…`,
    ready: 'Click anywhere to start exploring',
    error: `The ${mode} model failed to load.`,
  }[status]

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-paper text-slate-800">
      {/* Masthead */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <Box size={17} />
          </span>
          <div className="leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Chennai 3D Cadastre · Prototype
            </p>
            <h1 className="font-display text-[15px] font-semibold text-slate-900">3D Property Explorer · {p.name}</h1>
          </div>
        </div>

        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <span>Coimbatore</span>
          <span>›</span>
          <span className="font-semibold text-slate-700">{p.name}</span>
          <span>›</span>
          <span className="data-mono">{p.propertyId}</span>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-warn">
            <ShieldAlert size={12} /> Prototype 3D Model — Not a Surveyed Volume
          </span>
          <button
            onClick={returnToMap}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft size={13} /> Return to 3D map
          </button>
          {canClose && (
            <button
              onClick={() => window.close()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
              data-testid="coimbatore-explorer-close"
            >
              <X size={13} /> Close explorer
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — property identity, always available regardless of explorer state */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-surface p-3">
          <section className="rounded-md border border-primary/25 bg-primary/[0.06] p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{p.name}</p>
            <p className="data-mono mt-0.5 text-[12px] font-bold text-slate-900 break-all">{p.propertyId}</p>
          </section>
          <section className="rounded-md border border-brass/30 bg-brass/10 p-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-brass">Official ULPIN</p>
            <p className="data-mono mt-0.5 text-[13px] font-bold text-slate-900 break-all">{p.ulpin}</p>
          </section>
          <section>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Land Record</p>
            <Labelled label="District">{p.district} / {p.districtTamil}</Labelled>
            <Labelled label="Taluk">{p.taluk} / {p.talukTamil}</Labelled>
            <Labelled label="Village">{p.village} / {p.villageTamil}</Labelled>
            <Labelled label="Village LGD Code">{p.villageLgdCode}</Labelled>
            <Labelled label="Survey Number">{p.surveyNumber}</Labelled>
            <Labelled label="Sub Division">{p.subdivisionNumber}</Labelled>
            <Labelled label="Centroid"><span className="data-mono">{p.officialCentroid.lat}, {p.officialCentroid.lon}</span></Labelled>
          </section>
          <section>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Details</p>
            <Labelled label="View">{copy.heading}</Labelled>
            <Labelled label="Model">{mode === 'exterior' ? p.modelType : 'Reference interior scan'}</Labelled>
            <Labelled label="3D Model Verification">{p.verification}</Labelled>
            <Labelled label="Model Coordinates"><span className="data-mono">{p.lat}, {p.lon}</span></Labelled>
            <Labelled label="Location">{p.location}</Labelled>
          </section>
          <section>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <MapPin size={12} /> Provenance
            </p>
            <p className="text-[10px] leading-relaxed text-slate-500">
              {copy.provenance} The ULPIN and land-record fields above are official government-sourced data for this
              property; no owner, patta or tax record is attached, and the 3D reconstruction itself remains a
              synthetic, unsurveyed model.
            </p>
          </section>
        </aside>

        {/* CENTER — the walkthrough (Exterior ODM or Interior scan) */}
        <main className="relative min-w-0 flex-1 bg-[#151922]">
          {/* Mode switch — top-left, always clickable (even through the
              click-to-start blocker below), never covers the property panel. */}
          <div
            className="absolute left-3 top-3 z-20 flex gap-1 rounded-md border border-white/10 bg-[#191d26]/95 p-1 shadow-sm"
            data-testid="coimbatore-mode-switch"
          >
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => mode !== m.key && setMode(m.key)}
                data-testid={`coimbatore-mode-${m.key}`}
                className={
                  mode === m.key
                    ? 'rounded px-2.5 py-1 text-[12px] font-semibold bg-primary text-white'
                    : 'rounded px-2.5 py-1 text-[12px] font-semibold text-slate-300 hover:bg-white/10'
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Exterior camera presets — top-left, below the mode switch, only
              once the orbit scene has actually started (same gating as the
              interior's WASD legend below). Calls into
              CoimbatorePropertyScene's imperative setCameraPreset(key). */}
          {mode === 'exterior' && locked && (
            <div
              className="absolute left-3 top-12 z-20 flex gap-1 rounded-md border border-white/10 bg-[#191d26]/95 p-1 shadow-sm"
              data-testid="coimbatore-camera-presets"
            >
              {CAMERA_PRESET_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => sceneRef.current?.setCameraPreset(key)}
                  data-testid={`coimbatore-camera-preset-${key}`}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
                  title={COIMBATORE_CAMERA_PRESETS[key]?.label}
                >
                  <Video size={11} /> {COIMBATORE_CAMERA_PRESETS[key]?.label}
                </button>
              ))}
            </div>
          )}

          <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-[13px] text-slate-300">Preparing 3D explorer…</div>}>
            <CoimbatorePropertyScene ref={sceneRef} mode={mode} onStatusChange={setStatus} onLockChange={setLocked} />
          </Suspense>

          {!locked && (
            <div
              className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/40 backdrop-blur-sm"
              onClick={() => status === 'ready' && sceneRef.current?.lock()}
              data-testid="coimbatore-explorer-blocker"
            >
              <div className="rounded-lg border border-white/10 bg-[#191d26]/90 px-8 py-7 text-center text-white shadow-2xl">
                <h2 className="mb-1 font-display text-lg font-semibold">{p.name}</h2>
                <p className="mb-0.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {mode === 'exterior' ? <Box size={12} /> : <Home size={12} />} {copy.heading}
                </p>
                <p className="mb-5 flex items-center justify-center gap-1.5 text-[13px] text-slate-300">
                  {status === 'ready' ? <MousePointer2 size={14} /> : null} {statusLabel}
                </p>
                {status === 'ready' && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-left text-[12px] text-slate-300">
                    {(mode === 'exterior' ? EXTERIOR_CONTROLS : INTERIOR_CONTROLS).map((c) => (
                      <div key={c.key} className="flex items-center gap-2">
                        <span className="min-w-[64px] rounded bg-white/10 px-2 py-1 text-center text-[11px] font-bold text-white">
                          {c.label}
                        </span>
                        {c.desc}
                      </div>
                    ))}
                  </div>
                )}
                {status === 'error' && (
                  <p className="text-[11px] text-red-300">{copy.errorHint}</p>
                )}
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-black/40 px-4 py-2 text-[11px] text-slate-300">
            <MapPin size={12} /> {copy.footer}
          </div>
        </main>
      </div>
    </div>
  )
}
