import { Suspense, lazy, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Building2, Layers, Home, Box, ArrowLeft, X, Info, ShieldAlert, MapPin,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { volumeMetrics, volumeBoundsRows, geometryStatusTone } from '../lib/volume.js'
import { dateShort } from '../lib/format.js'

const BuildingScene = lazy(() =>
  import('../components/explorer/BuildingScene.jsx').then((m) => ({ default: m.BuildingScene })),
)

const VIEW_MODES = [
  { key: 'EXTERIOR', label: 'Exterior' },
  { key: 'INTERIOR', label: 'Interior' },
  { key: 'CUTAWAY', label: 'Cutaway' },
  { key: 'FLOOR_PLAN', label: 'Floor Plan' },
]

// ---------------------------------------------------------------------------
// Detailed 3D Building Explorer — standalone, opens in a NEW BROWSER TAB from a
// property / building / unit record via a deep link, e.g.
//   /3d-explorer?area=sholinganallur&ulpin=TN-CHN-123456789&buildingId=B01&floorId=F02&unitId=U201
//
// It is NOT a second Chennai viewer. The Chennai-wide geographic context stays
// in the single CesiumJS viewer on /map. This tab focuses on ONE building and
// uses the existing backend (GET /api/buildings/:id, /api/floors/:id) — no data
// source is duplicated and nothing authoritative is fabricated. Three.js is
// used only here, for the focused massing view.
// ---------------------------------------------------------------------------

const AREA_LABELS = {
  sholinganallur: 'Sholinganallur',
  adyar: 'Adyar',
  annanagar: 'Anna Nagar',
}

/** Accept either a short segment ("B01") or an already-qualified id. */
function qualify(ulpin, ...segments) {
  const parts = segments.filter(Boolean)
  const last = parts[parts.length - 1] || ''
  if (last.includes(ulpin)) return last
  return [ulpin, ...parts].join('-')
}

function Labelled({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-[12px] last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900 break-words">{children ?? '—'}</span>
    </div>
  )
}

function StatusPill({ tone = 'muted', children }) {
  const map = {
    ok: 'bg-teal/10 text-teal border-teal/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    err: 'bg-danger/5 text-danger border-danger/30',
    info: 'bg-primary/10 text-primary border-primary/25',
    muted: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map[tone] || map.muted}`}>
      {children}
    </span>
  )
}

export default function BuildingExplorer3D() {
  // Re-mount the whole explorer when the deep-link query changes so the initial
  // floor/unit selection is always re-derived — matters if the same open tab is
  // re-navigated to a different property (the common case is a fresh new tab).
  const [params] = useSearchParams()
  return <ExplorerBody key={params.toString()} params={params} />
}

function ExplorerBody({ params }) {
  const ulpin = params.get('ulpin') || 'TN-CHN-123456789'
  const area = (params.get('area') || '').toLowerCase()
  const buildingId = qualify(ulpin, params.get('buildingId') || 'B01')
  const floorParam = params.get('floorId')
  const unitParam = params.get('unitId')

  const [pickedFloorId, setPickedFloorId] = useState(
    floorParam ? qualify(ulpin, params.get('buildingId') || 'B01', floorParam) : null,
  )
  const [activeUnitId, setActiveUnitId] = useState(
    unitParam ? qualify(ulpin, params.get('buildingId') || 'B01', floorParam || 'F01', unitParam) : null,
  )
  const [viewMode, setViewMode] = useState('EXTERIOR')
  const setActiveFloorId = (id) => setPickedFloorId(id)

  const buildingQ = useApi(() => api.building(buildingId), [buildingId])
  const building = buildingQ.data?.building || null
  const approval = buildingQ.data?.approval || null
  const floors = useMemo(() => buildingQ.data?.floors || [], [buildingQ.data])

  // Effective active floor: an explicit pick, else the top floor once loaded.
  // Derived (not stored) so no state-sync effect is needed.
  const activeFloorId = useMemo(() => {
    if (pickedFloorId) return pickedFloorId
    if (!floors.length) return null
    return [...floors].sort((a, b) => (b.floorNumber ?? 0) - (a.floorNumber ?? 0))[0]?.floorId || null
  }, [pickedFloorId, floors])

  const floorQ = useApi(
    () => (activeFloorId ? api.floor(activeFloorId) : Promise.resolve(null)),
    [activeFloorId],
  )
  const activeFloor = floorQ.data?.floor || floors.find((f) => f.floorId === activeFloorId) || null
  const units = useMemo(() => floorQ.data?.units || [], [floorQ.data])

  const unitQ = useApi(
    () => (activeUnitId ? api.unit(activeUnitId).catch(() => null) : Promise.resolve(null)),
    [activeUnitId],
  )
  const unit = unitQ.data?.unit || null
  const unitVol = unitQ.data?.volume || unit?.volume || null
  const unitValidation = unitQ.data?.validation || null
  const governance = unitQ.data?.governance || {}

  // Phase 9 — Proposed 3D Property Identifier(s) linked to this building.
  // Reuses the existing identifier3d service (same GET /api/3d-identifiers
  // endpoint and useApi/idQ pattern as the unit-level panel in
  // PropertySidebar.jsx) — no second identifier system, no fabrication. An
  // empty result is an honest "none proposed yet", not a placeholder id.
  const idQ = useApi(
    () => (buildingId ? api.identifierList({ buildingId }).catch(() => []) : Promise.resolve([])),
    [buildingId],
  )
  const identifiers = idQ.data || []

  // Floors resolve as: loading (request in flight) -> available (>=1 floor)
  // -> unavailable (request settled, zero floors). Never a perpetual spinner.
  const floorsUnavailable = !buildingQ.loading && !buildingQ.error && !!building && floors.length === 0

  const buildingVol = building?.volume || null
  const activeFloorVol = activeFloor?.volume || null
  const shownVol = unitVol || activeFloorVol || buildingVol
  const vm = shownVol ? volumeMetrics(shownVol) : null

  const canClose = typeof window !== 'undefined' && window.opener && !window.opener.closed
  const returnToMap = () => {
    const q = new URLSearchParams()
    if (area) q.set('area', area)
    q.set('ulpin', ulpin)
    if (unit?.propertyId) q.set('unit', unit.propertyId)
    else q.set('building', buildingId)
    window.location.href = `/map?${q.toString()}`
  }

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
            <h1 className="font-display text-[15px] font-semibold text-slate-900">3D Building Explorer</h1>
          </div>
        </div>

        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <span>Chennai</span>
          <span>›</span>
          <span>{AREA_LABELS[area] || 'Area'}</span>
          <span>›</span>
          <span className="data-mono">{ulpin}</span>
          <span>›</span>
          <span className="font-semibold text-slate-700">{building?.shortName || buildingId}</span>
          {activeFloor && <><span>›</span><span>{activeFloor.label}</span></>}
          {unit && <><span>›</span><span>{unit.unitId}</span></>}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-warn">
            <ShieldAlert size={12} /> Prototype · Not an Official ULPIN
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
              data-testid="explorer-close"
            >
              <X size={13} /> Close explorer
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — hierarchy / floor + unit navigation */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-surface p-3">
          <section>
            <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Building</p>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px]">
              <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Building2 size={13} className="text-primary" /> {building?.shortName || '—'}
              </p>
              <p className="mt-0.5 data-mono text-[11px] text-slate-500 break-all">{buildingId}</p>
              <p className="mt-1 text-slate-500">
                {building ? `${building.totalFloors} floors · ${buildingQ.data?.unitCount ?? '—'} units` : 'Loading…'}
              </p>
            </div>
          </section>

          <section>
            <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Floors</p>
            <ul className="space-y-1" data-testid="explorer-floor-list">
              {[...floors].sort((a, b) => (b.floorNumber ?? 0) - (a.floorNumber ?? 0)).map((f) => (
                <li key={f.floorId}>
                  <button
                    onClick={() => { setActiveFloorId(f.floorId); setActiveUnitId(null) }}
                    data-testid={`explorer-floor-${f.floorSegment || f.floorNumber}`}
                    className={
                      f.floorId === activeFloorId
                        ? 'flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-left text-[12px] font-semibold text-primary'
                        : 'flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] text-slate-600 hover:bg-slate-100'
                    }
                  >
                    <Layers size={12} />
                    <span>{f.label}</span>
                    <span className="ml-auto text-[10px] text-slate-400">{f.unitCount ?? 0}u</span>
                  </button>
                </li>
              ))}
              {!floors.length && buildingQ.loading && (
                <li className="text-[12px] text-slate-400">Loading floors…</li>
              )}
              {floorsUnavailable && (
                <li className="text-[12px] font-medium text-warn" data-testid="explorer-floors-unavailable">
                  Floor data unavailable.
                </li>
              )}
            </ul>
          </section>

          <section>
            <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Units on {activeFloor?.label || 'floor'}
            </p>
            <ul className="grid grid-cols-2 gap-1" data-testid="explorer-unit-list">
              {units.map((u) => {
                const on = u.propertyId === activeUnitId || u.unitId === activeUnitId
                return (
                  <li key={u.propertyId}>
                    <button
                      onClick={() => setActiveUnitId(u.propertyId)}
                      data-testid={`explorer-unit-${u.unitId}`}
                      className={
                        on
                          ? 'flex w-full items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-1 text-left text-[11px] font-semibold text-warn'
                          : 'flex w-full items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-100'
                      }
                      title={u.propertyId}
                    >
                      <Home size={10} className="text-primary" />
                      <span className="data-mono">{u.unitId}</span>
                      <span className="ml-auto text-slate-400">{u.bedrooms || u.usage?.[0]}</span>
                    </button>
                  </li>
                )
              })}
              {!units.length && <li className="col-span-2 text-[12px] text-slate-400">No units listed.</li>}
            </ul>
          </section>
        </aside>

        {/* CENTER — focused Three.js massing view */}
        <main className="relative min-w-0 flex-1 bg-paper">
          {/* view-mode toolbar (spec sections 16-19) */}
          <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-md border border-slate-200 bg-surface/95 p-1 shadow-sm" data-testid="explorer-view-modes">
            {VIEW_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setViewMode(m.key)}
                data-testid={`explorer-mode-${m.key}`}
                className={
                  viewMode === m.key
                    ? 'rounded px-2.5 py-1 text-[12px] font-semibold bg-primary text-white'
                    : 'rounded px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-100'
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          {buildingQ.loading && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-slate-500">Loading building…</div>
          )}
          {buildingQ.error && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-danger">
              Could not load {buildingId}: {String(buildingQ.error.message || buildingQ.error)}
            </div>
          )}
          {floorsUnavailable && viewMode !== 'EXTERIOR' && (
            <div
              className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px] font-semibold text-warn"
              data-testid="explorer-interior-unavailable"
            >
              {viewMode === 'INTERIOR' && 'INTERIOR DATA UNAVAILABLE'}
              {viewMode === 'CUTAWAY' && 'INTERIOR DATA UNAVAILABLE — no floor data to cut away'}
              {viewMode === 'FLOOR_PLAN' && 'INTERIOR DATA UNAVAILABLE — no floor plan on record'}
            </div>
          )}
          {building && (
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-[13px] text-slate-500">Preparing 3D view…</div>}>
              <BuildingScene
                building={building}
                floors={floors}
                units={units}
                activeFloorId={activeFloorId}
                activeUnitId={activeUnitId}
                viewMode={viewMode}
                onSelectFloor={(id) => { setActiveFloorId(id); setActiveUnitId(null) }}
                onSelectUnit={(id) => setActiveUnitId(id)}
              />
            </Suspense>
          )}

          {/* BOTTOM — legend + provenance line */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-surface/95 px-4 py-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-primary/50" /> Active floor</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-slate-400/40" /> Other floors</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: '#b7791f' }} /> Selected unit</span>
            <span className="ml-auto flex items-center gap-1.5">
              <MapPin size={12} /> Prototype 3D volume model · synthetic DEMO geometry · not a surveyed cadastral volume
            </span>
          </div>
        </main>

        {/* RIGHT — selected property / volume / provenance / governance */}
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-surface p-3">
          <section className="rounded-md border border-primary/25 bg-primary/[0.06] p-2.5">
            <p className="font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {unit ? 'Apartment / Unit' : activeFloor ? 'Floor' : 'Building'}
            </p>
            <p className="mt-0.5 data-mono text-[13px] font-bold text-slate-900 break-all">
              {unit?.propertyId || activeFloor?.floorId || buildingId}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unit && <StatusPill tone="info">{unit.status || 'Unit'}</StatusPill>}
              {unit?.usage && <StatusPill tone="muted">{unit.usage}</StatusPill>}
              {!unit && activeFloor && <StatusPill tone="muted">{activeFloor.floorSegment}</StatusPill>}
              <StatusPill tone="warn">3D Cadastral Reference ID · prototype</StatusPill>
            </div>
          </section>

          {/* Identity / hierarchy */}
          <section>
            <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Hierarchy</p>
            <Labelled label="Area">{AREA_LABELS[area] || '—'}</Labelled>
            <Labelled label="Parcel ULPIN"><span className="data-mono">{ulpin}</span></Labelled>
            <Labelled label="Building">{building?.name || building?.shortName || buildingId}</Labelled>
            <Labelled label="Floor">{activeFloor ? `${activeFloor.label} (${activeFloor.floorSegment})` : '—'}</Labelled>
            <Labelled label="Unit">{unit ? `${unit.unitId} · Apt ${unit.apartmentNumber}` : '—'}</Labelled>
            <Labelled label="Volume ID">
              <span className="data-mono">{shownVol?.volumeId || '—'}</span>
            </Labelled>
          </section>

          {/* Property detail */}
          {unit && (
            <section>
              <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Unit details</p>
              <Labelled label="Carpet area">{unit.carpetAreaSqft ? `${unit.carpetAreaSqft} sq.ft` : '—'}</Labelled>
              <Labelled label="Built-up area">{unit.builtUpAreaSqft ? `${unit.builtUpAreaSqft} sq.ft` : '—'}</Labelled>
              <Labelled label="Bedrooms">{unit.bedrooms ?? '—'}</Labelled>
              <Labelled label="Facing">{unit.facing || '—'}</Labelled>
              <Labelled label="Completion">{unit.completionYear || '—'}</Labelled>
              <Labelled label="Owner (synthetic)">{unit.owner?.name || '—'}</Labelled>
            </section>
          )}
          {!unit && building && (
            <section>
              <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Building details</p>
              <Labelled label="Name">{building.name || '—'}</Labelled>
              <Labelled label="Floors">{building.totalFloors ?? '—'}</Labelled>
              <Labelled label="Height">{building.heightM ? `${building.heightM} m` : '—'}</Labelled>
              <Labelled label="Structure">{building.structureType || building.constructionType || '—'}</Labelled>
              <Labelled label="Approval no."><span className="data-mono">{approval?.approvalNumber || 'Not available'}</span></Labelled>
              <Labelled label="Approval status">{approval?.status || 'Not available'}</Labelled>
            </section>
          )}

          {/* Proposed 3D Property Identifier (Phase 9) — building-scoped */}
          <section>
            <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Proposed 3D Property Identifier
            </p>
            {idQ.loading && <p className="text-[12px] text-slate-400">Loading…</p>}
            {!idQ.loading && identifiers.length === 0 && (
              <div data-testid="explorer-identifier-unavailable">
                <p className="text-[12px] font-semibold text-slate-700">3D Property Identifier: Unavailable</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  No associated 3D Property Identifier record is currently available for this building.
                </p>
              </div>
            )}
            {identifiers.length > 0 && (
              <div data-testid="explorer-identifier">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-warn">
                  <ShieldAlert size={11} /> Proposed / research reference — not an Official 3D ULPIN, not a
                  government-approved 3D cadastral standard.
                </p>
                {identifiers.map((r) => (
                  <div key={r.identifierId} className="mb-2 rounded border border-warn/30 bg-warn/10 p-2 text-[11px] last:mb-0">
                    <p className="data-mono text-slate-900 break-all">{r.canonicalIdentifier}</p>
                    <Labelled label="Official ULPIN">
                      <span className="data-mono">{r.officialULPIN || 'Unavailable from current source'}</span>
                    </Labelled>
                    <Labelled label="Building ID"><span className="data-mono">{r.buildingId || '—'}</span></Labelled>
                    <Labelled label="Floor"><span className="data-mono">{r.floorId || '—'}</span></Labelled>
                    <Labelled label="Unit"><span className="data-mono">{r.propertyId || '—'}</span></Labelled>
                    <Labelled label="Volume ID"><span className="data-mono">{r.volumeId || '—'}</span></Labelled>
                    <Labelled label="Geometry version">{r.geometryVersion ?? '—'}</Labelled>
                    <Labelled label="Status">{r.status || '—'}</Labelled>
                    <Labelled label="Provenance">{r.provenance || r.source || 'DEMO'}</Labelled>
                    <Labelled label="Verification">{r.verificationStatus || 'UNVERIFIED'}</Labelled>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3D volume */}
          <section>
            <p className="mb-1 flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Box size={12} /> 3D volume information
            </p>
            <p className="mb-1.5 rounded bg-warn/10 px-2 py-1 text-[10px] text-warn">
              Prototype 3D geometry — synthetic, not an official cadastral volume.
            </p>
            {shownVol ? (
              <>
                {Object.entries(volumeBoundsRows(shownVol)).map(([k, v]) => (
                  <Labelled key={k} label={k}><span className="data-mono">{v}</span></Labelled>
                ))}
                <Labelled label="Est. height">{vm?.heightM != null ? `${vm.heightM} m` : 'Not available'}</Labelled>
                <Labelled label="Est. footprint">{vm?.footprintM2 != null ? `${vm.footprintM2} m²` : 'Not available'}</Labelled>
                <Labelled label="Est. volume">{vm?.volumeM3 != null ? `${vm.volumeM3} m³` : 'Not available'}</Labelled>
                <Labelled label="Geometry version">{shownVol.geometryVersion ?? 1}</Labelled>
              </>
            ) : (
              <p className="text-[12px] text-slate-400">No prototype volume for this selection.</p>
            )}
          </section>

          {/* Geometry status */}
          {unitValidation && (
            <section>
              <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Geometry status</p>
              <div className="flex items-center gap-2">
                <StatusPill tone={geometryStatusTone(unitValidation.status).tone}>
                  {geometryStatusTone(unitValidation.status).label}
                </StatusPill>
                <span className="text-[11px] text-slate-500">deterministic validation (Phase 9)</span>
              </div>
              {(unitValidation.issues || []).length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                  {unitValidation.issues.map((i, idx) => (
                    <li key={`${i.rule}-${idx}`}>
                      <span className={i.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{i.status}</span>{' '}
                      <span className="data-mono text-slate-500">{i.rule}</span> — {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Provenance & status */}
          <section>
            <p className="mb-1 flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Info size={12} /> Provenance &amp; status
            </p>
            <Labelled label="Spatial data">
              <StatusPill tone="warn">DEMO</StatusPill>
            </Labelled>
            <Labelled label="3D geometry">
              <StatusPill tone="warn">PROTOTYPE / AI_DERIVED</StatusPill>
            </Labelled>
            <Labelled label="Official ULPIN link">
              <StatusPill tone="muted">UNVERIFIED</StatusPill>
            </Labelled>
            <Labelled label="Source">{shownVol?.source || 'DEMO'}</Labelled>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              Coordinates are realistic Chennai positions but represent no real parcel, building, person
              or government record. The combined building/floor/unit identifier is a
              <b> Proposed 3D Property Identifier</b> — it is not an official ULPIN and not a
              government-approved 3D cadastral standard.
            </p>
          </section>

          {/* Governance (read-only, labelled) */}
          {unit && (
            <section>
              <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-slate-500">Governance (DEMO / MOCK)</p>
              <Labelled label="Registration"><span className="data-mono">{governance.registration?.docNumber || 'Not available'}</span></Labelled>
              <Labelled label="Registered on">
                <span className="data-mono">
                  {governance.registration?.registeredOn ? dateShort(governance.registration.registeredOn) : '—'}
                </span>
              </Labelled>
              <Labelled label="Encumbrance">{governance.encumbrance?.type || 'Nil'}</Labelled>
              <Labelled label="Property tax">{governance.propertyTax?.status || 'Not available'}</Labelled>
              <p className="mt-1 text-[10px] text-slate-500">
                Land Records / Registration / Property Tax are DEMO / MOCK adapters — no live government connectivity.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
