import { Suspense, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Waypoints, ArrowLeft, X, ShieldAlert, Search, RotateCcw, ArrowUpToLine,
  ArrowDownToLine, Crosshair, Info, MapPin, Layers3,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { lazyWithRetry } from '../lib/lazyWithRetry.js'
import { LOCALITIES_FALLBACK, DEFAULT_AREA_ID } from '../lib/constants.js'
import {
  UNDERGROUND_LAYERS, layerForType, groupByLayer, matchInfra, drawDepth,
  provenanceView, dimText, diameterText, DEPTH_MODES, VIEW_MODES,
} from '../lib/underground3d.js'

const UndergroundScene = lazyWithRetry(
  () => import('../components/explorer/UndergroundScene.jsx').then((m) => ({ default: m.UndergroundScene })),
  'UndergroundScene',
)

// ---------------------------------------------------------------------------
// Underground Infrastructure 3D Explorer — standalone route, opens in a NEW
// BROWSER TAB from the Underground Infrastructure page / 3D map sidebar via a
// deep link, e.g.
//   /underground-explorer?area=sholinganallur&ulpin=TN-CHN-123456789&infrastructureId=INF-DEMO-SHLN-METRO-0001
//
// It is NOT a second Chennai geographic viewer. The Chennai-wide map stays in
// the single CesiumJS viewer on /map; this tab is ONE focused Three.js scene.
// It re-reads the EXISTING Phase 8 backend (GET /api/infrastructure*,
// /api/gis/buildings, /api/gis/parcels) — no data source is duplicated and
// nothing authoritative is fabricated.
// ---------------------------------------------------------------------------

const asArray = (d) => (Array.isArray(d) ? d : Array.isArray(d?.infrastructure) ? d.infrastructure : [])
const asFeatures = (d) => (Array.isArray(d?.features) ? d.features : [])

function Field({ label, children, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-[12px] last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`text-right font-medium text-slate-900 break-words ${mono ? 'data-mono' : ''}`}>{children ?? '—'}</span>
    </div>
  )
}

function DemoBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-warn"
      data-testid="underground-demo-badge"
    >
      <ShieldAlert size={12} /> DEMO DATA — Not Authoritative
    </span>
  )
}

export default function UndergroundExplorer3D() {
  const [params] = useSearchParams()
  return <ExplorerBody key={params.toString()} params={params} />
}

function ExplorerBody({ params }) {
  const areaParam = (params.get('area') || DEFAULT_AREA_ID).toLowerCase()
  const ulpinParam = params.get('ulpin') || null
  const infraParam = params.get('infrastructureId') || null

  const [area, setArea] = useState(areaParam)
  const [rawSelectedId, setSelectedId] = useState(infraParam)
  const [query, setQuery] = useState('')
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(UNDERGROUND_LAYERS.map((l) => l.key)))
  const [sliceDepth, setSliceDepth] = useState(6)
  const [depthMode, setDepthMode] = useState('ALL')
  const [viewMode, setViewMode] = useState('CUTAWAY')
  const [command, setCommand] = useState(null)
  const [expanded, setExpanded] = useState(null)

  // ---- locality registry (for the area selector + scene origin) ----
  const locQ = useApi(() => api.gisLocalities().catch(() => null), [])
  const localities = useMemo(() => {
    const list = locQ.data?.localities
    return Array.isArray(list) && list.length ? list : LOCALITIES_FALLBACK
  }, [locQ.data])
  const activeLocality = useMemo(
    () => localities.find((l) => l.id === area) || localities[0] || LOCALITIES_FALLBACK[0],
    [localities, area],
  )
  const origin = activeLocality?.base || LOCALITIES_FALLBACK[0].base

  // ---- infrastructure + surface context for the area ----
  const infraQ = useApi(() => api.infrastructureList({ area }), [area])
  const buildingsQ = useApi(() => api.gisBuildings({ locality: area }).catch(() => null), [area])
  const parcelsQ = useApi(() => api.gisParcels({ locality: area }).catch(() => null), [area])

  const allRows = useMemo(() => asArray(infraQ.data), [infraQ.data])
  const rows = useMemo(() => allRows.filter((r) => matchInfra(r, query)), [allRows, query])
  const buildings = useMemo(() => asFeatures(buildingsQ.data), [buildingsQ.data])
  const parcels = useMemo(() => {
    const all = asFeatures(parcelsQ.data)
    if (!ulpinParam) return all
    const focused = all.filter((f) => f.properties?.ulpin === ulpinParam)
    return focused.length ? focused : all
  }, [parcelsQ.data, ulpinParam])

  const grouped = useMemo(() => groupByLayer(allRows), [allRows])

  // A selection is only valid while its record is present for the current area
  // (derived, so switching area silently clears a stale selection — no effect).
  const selectedId = useMemo(
    () => (rawSelectedId && (infraQ.loading || allRows.some((r) => r.infrastructureId === rawSelectedId)) ? rawSelectedId : null),
    [rawSelectedId, allRows, infraQ.loading],
  )

  // ---- selected record detail + property relations ----
  const detailQ = useApi(
    () => (selectedId ? api.infrastructure(selectedId).catch(() => null) : Promise.resolve(null)),
    [selectedId],
  )
  const relQ = useApi(
    () => (selectedId ? api.infrastructureRelations(selectedId).catch(() => null) : Promise.resolve(null)),
    [selectedId],
  )
  const selected = detailQ.data || allRows.find((r) => r.infrastructureId === selectedId) || null

  const cmdSeq = useRef(0)
  const fireCommand = (kind) => { cmdSeq.current += 1; setCommand({ kind, n: cmdSeq.current }) }
  const depthState = useMemo(() => ({ sliceDepth, mode: depthMode }), [sliceDepth, depthMode])
  const toggleLayer = (key) => setVisibleLayers((s) => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const focusInfra = (id) => { setSelectedId(id); fireCommand('fit') }

  const canClose = typeof window !== 'undefined' && window.opener && !window.opener.closed
  const areaLabel = activeLocality?.name || activeLocality?.label || area

  const listError = infraQ.error
  const noData = !infraQ.loading && !listError && allRows.length === 0

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-paper text-slate-800">
      {/* Masthead */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <Waypoints size={17} />
          </span>
          <div className="leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Chennai 3D Land Governance · Prototype
            </p>
            <h1 className="font-display text-[15px] font-semibold text-slate-900">Underground Infrastructure Explorer</h1>
          </div>
        </div>

        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <span>Chennai</span><span>›</span>
          <span className="font-semibold text-slate-700">{areaLabel}</span>
          {ulpinParam && (<><span>›</span><span className="data-mono">{ulpinParam}</span></>)}
          {selected && (<><span>›</span><span className="data-mono">{selected.infrastructureId}</span></>)}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <DemoBadge />
          <a
            href="/underground"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft size={13} /> Underground page
          </a>
          {canClose && (
            <button
              onClick={() => window.close()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
              data-testid="underground-explorer-close"
            >
              <X size={13} /> Close explorer
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — layer panel + search + area selector */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-surface p-3">
          <section>
            <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Area / Locality</label>
            <select
              value={area}
              onChange={(e) => { setArea(e.target.value); setSelectedId(null) }}
              data-testid="underground-area-select"
              className="input !py-1 [&>option]:bg-surface"
            >
              {localities.map((l) => <option key={l.id} value={l.id}>{l.name || l.label}</option>)}
            </select>
          </section>

          <section>
            <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Search infrastructure…</label>
            <div className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2">
              <Search size={13} className="text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ID · ULPIN · type · locality"
                data-testid="underground-search"
                className="w-full bg-transparent py-1.5 text-[12px] outline-none"
              />
            </div>
          </section>

          <section>
            <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Underground Layers</p>
            <ul className="space-y-1" data-testid="underground-layer-panel">
              {grouped.map(({ layer, items }) => {
                const on = visibleLayers.has(layer.key)
                const shown = items.filter((r) => matchInfra(r, query))
                const isOpen = expanded === layer.key
                return (
                  <li key={layer.key} className="rounded-md border border-slate-200">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleLayer(layer.key)}
                        data-testid={`underground-layer-${layer.key}`}
                        aria-label={layer.label}
                      />
                      <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ background: layer.color }} />
                      <button
                        className="flex-1 text-left text-[12px] font-semibold text-slate-700"
                        onClick={() => setExpanded(isOpen ? null : layer.key)}
                      >
                        {layer.label}
                      </button>
                      <span className="rounded bg-slate-100 px-1.5 text-[11px] data-mono text-slate-600" data-testid={`underground-count-${layer.key}`}>
                        {items.length}
                      </span>
                    </div>
                    <p className="px-2 pb-1 text-[10px] text-slate-400">
                      {items.length === 0
                        ? 'Data unavailable'
                        : `${layer.form} · ${items.every((r) => provenanceView(r).demo) ? 'DEMO' : 'MIXED'} provenance`}
                    </p>
                    {isOpen && items.length > 0 && (
                      <ul className="max-h-40 overflow-y-auto border-t border-slate-100">
                        {shown.map((r) => (
                          <li key={r.infrastructureId}>
                            <button
                              onClick={() => focusInfra(r.infrastructureId)}
                              data-testid={`underground-item-${r.infrastructureId}`}
                              className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[11px] hover:bg-slate-50 ${
                                r.infrastructureId === selectedId ? 'bg-warn/10 font-semibold text-warn' : 'text-slate-600'
                              }`}
                            >
                              <span className="data-mono truncate">{r.infrastructureId}</span>
                              <span className="shrink-0 text-slate-400">
                                {(() => { const d = drawDepth(r); return d.known ? `−${d.value} m` : 'depth n/a' })()}
                              </span>
                            </button>
                          </li>
                        ))}
                        {shown.length === 0 && <li className="px-2 py-1 text-[11px] text-slate-400">No match in this layer.</li>}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-md border border-warn/30 bg-warn/10 p-2 text-[10px] leading-relaxed text-warn">
            <p className="font-bold">DEMO DATA</p>
            <p>Not authoritative utility infrastructure information. Synthetic demonstration geometry, depths and dimensions — never surveyed, never official.</p>
          </section>
        </aside>

        {/* CENTER — the 3D scene */}
        <main className="relative min-w-0 flex-1 bg-paper">
          {(infraQ.loading || locQ.loading) && (
            <div className="absolute inset-0 z-10 grid place-items-center text-[13px] text-slate-500">Loading underground scene…</div>
          )}
          {listError && (
            <div className="absolute inset-0 z-10 grid place-items-center">
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-center text-[13px] text-danger">
                <p className="font-semibold">Unable to load underground infrastructure.</p>
                <button className="btn-ghost mt-2" onClick={() => { infraQ.reload() }}>Retry</button>
              </div>
            </div>
          )}
          {noData && (
            <div className="absolute inset-0 z-10 grid place-items-center">
              <div className="rounded-lg border border-slate-200 bg-surface p-4 text-center text-[13px] text-slate-600">
                No underground infrastructure data available for this area.
              </div>
            </div>
          )}

          <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-[13px] text-slate-500">Preparing 3D view…</div>}>
            <UndergroundScene
              origin={origin}
              infra={rows}
              buildings={buildings}
              parcels={parcels}
              visibleLayers={visibleLayers}
              depthState={depthState}
              viewMode={viewMode}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              command={command}
            />
          </Suspense>

          {/* camera controls */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            {[
              ['reset', 'Reset', RotateCcw],
              ['top', 'Top', ArrowUpToLine],
              ['underground', 'Underground', ArrowDownToLine],
              ['fit', 'Fit Selection', Crosshair],
            ].map(([kind, label, Icon]) => (
              <button
                key={kind}
                onClick={() => fireCommand(kind)}
                disabled={kind === 'fit' && !selectedId}
                data-testid={`underground-cam-${kind}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-surface/95 px-2 py-1.5 text-[11px] font-semibold text-slate-700 shadow-card backdrop-blur-sm hover:bg-slate-100 disabled:opacity-40"
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {/* legend — icons + labels + shape names, not colour alone */}
          <div className="panel pointer-events-none absolute bottom-3 left-3 p-2.5 text-[10px] text-slate-600">
            <p className="mb-1 font-display font-bold uppercase tracking-wider text-slate-500">Underground Infrastructure</p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {UNDERGROUND_LAYERS.map((l) => (
                <li key={l.key} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-400" style={{ background: l.color }} />
                  <span>{l.label}</span>
                  <span className="text-slate-400">· {l.shape}</span>
                </li>
              ))}
            </ul>
          </div>
        </main>

        {/* RIGHT — selected infrastructure + depth view + property context */}
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-surface p-3">
          <section className="rounded-md border border-primary/25 bg-primary/[0.06] p-2.5">
            <p className="font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected Infrastructure</p>
            {selected ? (
              <p className="mt-0.5 data-mono text-[13px] font-bold text-slate-900 break-all" data-testid="underground-selected-id">
                {selected.infrastructureId}
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] text-slate-500">Click an object in the scene, or a layer item on the left.</p>
            )}
          </section>

          {selected && <SelectedPanel rec={selected} rel={relQ.data} loading={detailQ.loading} />}

          {/* Depth view — allowed ONLY because every value shown is DEMO / synthetic */}
          <section data-testid="underground-depth-view">
            <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Depth View</p>
            <p className="mb-1.5 rounded bg-warn/10 px-2 py-1 text-[10px] text-warn">
              Synthetic demonstration depths only — not authoritative Chennai engineering depths.
            </p>
            <div className="space-y-1 data-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-500"><span>Ground level</span><span>0 m</span></div>
              {grouped.filter((g) => g.items.length).map(({ layer, items }) => {
                const depths = items.map((r) => drawDepth(r)).filter((d) => d.known).map((d) => d.value)
                const label = depths.length
                  ? `−${Math.min(...depths)}${depths.length > 1 && Math.min(...depths) !== Math.max(...depths) ? ` … −${Math.max(...depths)}` : ''} m`
                  : 'Unavailable'
                return (
                  <div key={layer.key} className="flex items-center justify-between text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm" style={{ background: layer.color }} /> {layer.label}
                    </span>
                    <span>{label}</span>
                  </div>
                )
              })}
            </div>
          </section>
        </aside>
      </div>

      {/* BOTTOM — depth slider + modes + view mode */}
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-200 bg-surface px-4 py-2 text-[12px]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-600">Depth</span>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={sliceDepth}
            onChange={(e) => setSliceDepth(Number(e.target.value))}
            data-testid="underground-depth-slider"
            className="w-40"
          />
          <span className="w-14 data-mono text-slate-700">−{sliceDepth} m</span>
        </div>

        <div className="flex items-center gap-1.5" data-testid="underground-depth-modes">
          {DEPTH_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setDepthMode(m.key)}
              data-testid={`underground-mode-${m.key}`}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                depthMode === m.key ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {VIEW_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setViewMode(m.key)}
              data-testid={`underground-view-${m.key}`}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                viewMode === m.key ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          <Layers3 size={12} /> ONE Three.js scene · the Chennai-wide map stays in the single Cesium viewer
        </span>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
function SelectedPanel({ rec, rel, loading }) {
  const layer = layerForType(rec.type)
  const depth = drawDepth(rec)
  const prov = provenanceView(rec)
  const parcelRelations = rel?.parcelRelations || []
  const isMetro = rec.type === 'METRO'

  return (
    <>
      <section data-testid="underground-info-panel">
        <p className="mb-1 flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <Info size={12} /> {layer.label}
        </p>
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{rec.type}</span>
          {prov.demo && (
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-warn" data-testid="underground-info-provenance">
              {prov.verificationStatus || 'DEMO'}
            </span>
          )}
        </div>
        {loading && <p className="text-[11px] text-slate-400">Loading detail…</p>}
        <Field label="Infrastructure ID" mono>{rec.infrastructureId}</Field>
        <Field label="Type">{rec.type}</Field>
        <Field label="Subtype">{rec.subtype || 'Unavailable'}</Field>
        <Field label="Owner / Authority">{rec.ownerAuthority || (prov.demo ? 'DEMO' : 'Unavailable')}</Field>
        <Field label="Depth" mono>{depth.known ? `−${depth.value} m` : 'Unavailable'}</Field>
        {(layer.shape === 'pipe') && <Field label="Diameter" mono>{diameterText(rec)}</Field>}
        {(layer.shape !== 'pipe') && (
          <>
            <Field label="Width" mono>{dimText(rec.widthM)}</Field>
            <Field label="Height" mono>{dimText(rec.heightM)}</Field>
          </>
        )}
        <Field label="Material">Unavailable</Field>
        <Field label="Status">{rec.status || 'UNKNOWN'}</Field>
        <Field label="Source">{prov.source}</Field>
        <Field label="Provenance">{prov.provenance}</Field>
        <Field label="Verification">{prov.verificationStatus}</Field>
        <Field label="Timestamp" mono>{prov.timestamp ? String(prov.timestamp).slice(0, 19).replace('T', ' ') : 'Unavailable'}</Field>
        {isMetro && (
          <p className="mt-1.5 text-[10px] text-warn">
            Demonstration geometry — authoritative infrastructure geometry unavailable.
          </p>
        )}
      </section>

      <section data-testid="underground-property-context">
        <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Property Relationship</p>
        <p className="mb-1.5 text-[10px] text-warn">
          A spatial intersection does <strong>not</strong> establish legal ownership.
        </p>
        <Field label="Associated Parcel" mono>{rec.parentParcelULPIN || rec.parentParcel || 'Unavailable'}</Field>
        <Field label="Spatial Relationship">{rec.spatialRelation || rel?.spatialRelation || 'Unavailable'}</Field>
        <Field label="Associated Building" mono>{rec.parentBuilding || 'Unavailable'}</Field>
        <Field label="Legal Ownership">{rec.legalOwnership || 'NOT_PROVIDED'}</Field>
        {parcelRelations.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600" data-testid="underground-affected-properties">
            <li className="font-semibold text-slate-500">Affected / intersecting properties</li>
            {parcelRelations.slice(0, 6).map((r) => (
              <li key={r.parcelId || r.ulpin} className="flex items-center gap-1.5">
                <MapPin size={10} className="text-primary" />
                <span className="data-mono">{r.ulpin || r.parcelId}</span>
                <span className="text-slate-400">· {r.spatialRelation}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          {rel?.ownershipNote || 'Legal ownership is only shown when authoritative data supplies it.'}
        </p>
      </section>
    </>
  )
}
