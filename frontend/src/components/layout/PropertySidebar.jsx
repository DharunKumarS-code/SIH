import { useState } from 'react'
import clsx from 'clsx'
import {
  X, Crosshair, Focus, ShieldCheck, FileText, Share2, StickyNote, Building2, Layers, Home,
  BadgeCheck, TriangleAlert, MapPin, ExternalLink, Box, Mountain, Satellite,
} from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApi } from '../../lib/useApi.js'
import { api } from '../../lib/api.js'
import { Badge, DemoTag, KeyValue, Spinner, ErrorNote } from '../ui/primitives.jsx'
import { inr } from '../../lib/format.js'
import { PROTOTYPE_ID_LABEL } from '../../lib/constants.js'
import { verificationBadge, isOfficial } from '../../lib/provenance.js'
import { volumeMetrics, volumeBoundsRows, geometryStatusTone } from '../../lib/volume.js'

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-white/10 py-2">
      <button className="flex w-full items-center justify-between py-1 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="section-title">{title}</span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  )
}

export function PropertySidebar() {
  const { selection, isolated, setIsolated, reset, mapApi, selectBuilding } = useSelection()
  const { can } = useAuth()
  const [note, setNote] = useState('')

  const isUnit = selection.mode === 'unit' && selection.propertyId
  const isParcel = selection.mode === 'parcel' && !!selection.ulpin
  const isAi = selection.mode === 'ai-building' && !!selection.aiBuildingId
  const isAiFp = selection.mode === 'ai-floor-unit' && !!selection.aiFloorUnitId
  const isGnss = selection.mode === 'gnss-point' && !!selection.controlPointId
  const isBuildingLevel = (selection.mode === 'building' || selection.mode === 'floor') && !!selection.buildingId
  const { data, error, loading, reload } = useApi(
    () => (isUnit ? api.unit(selection.propertyId) : Promise.resolve(null)),
    [isUnit, selection.propertyId],
  )
  const parcelQ = useApi(
    () => (isParcel ? api.parcel(selection.ulpin) : Promise.resolve(null)),
    [isParcel, selection.ulpin],
  )
  const aiQ = useApi(
    () => (isAi ? api.aiBuilding(selection.aiBuildingId) : Promise.resolve(null)),
    [isAi, selection.aiBuildingId],
  )
  const aiFpQ = useApi(
    () => (isAiFp ? api.aiFloorUnit(selection.aiFloorUnitId) : Promise.resolve(null)),
    [isAiFp, selection.aiFloorUnitId],
  )
  const gnssQ = useApi(
    () => (isGnss ? api.gnssControlPoint(selection.controlPointId) : Promise.resolve(null)),
    [isGnss, selection.controlPointId],
  )
  // Phase 6 — DEM/DSM elevation residual for the selected control point, when
  // one is available (spec section 15). Never fabricated: a point with no
  // supplied height, or no DEM/DSM-derived building height nearby, comes back
  // dataAvailability: 'UNAVAILABLE' rather than a guessed number.
  const gnssElevQ = useApi(
    () => (isGnss ? api.gnssControlPointElevationResidual(selection.controlPointId).catch(() => null) : Promise.resolve(null)),
    [isGnss, selection.controlPointId],
  )
  // Phase 5 — elevation-derived building height, shown alongside the
  // building/floor placeholder (spec section 22). Purely additive: falls
  // back to "Unavailable" if no elevation dataset has been processed yet.
  const elevQ = useApi(
    () => (isBuildingLevel ? api.elevationBuildingHeight(selection.buildingId).catch(() => null) : Promise.resolve(null)),
    [isBuildingLevel, selection.buildingId],
  )

  if (!isUnit) {
    if (isParcel) {
      return <ParcelCard query={parcelQ} ulpin={selection.ulpin} mapApi={mapApi} onClose={reset} canVerify={can('parcel:verify')} />
    }
    if (isAi) {
      return <AiBuildingCard query={aiQ} id={selection.aiBuildingId} onClose={reset} canReview={can('change-detection:review')} />
    }
    if (isAiFp) {
      return <AiFloorUnitCard query={aiFpQ} id={selection.aiFloorUnitId} onClose={reset} mapApi={mapApi} canReview={can('change-detection:review')} />
    }
    if (isGnss) {
      return <GnssPointCard query={gnssQ} elevQuery={gnssElevQ} id={selection.controlPointId} onClose={reset} mapApi={mapApi} canReview={can('change-detection:review')} />
    }
    return (
      <aside className="pointer-events-auto absolute right-3 top-3 z-30 w-80 rounded-xl panel p-4" data-testid="property-sidebar">
        <p className="section-title">Property / Unit Details</p>
        <p className="mt-2 text-sm text-slate-400">
          {selection.mode === 'building'
            ? 'Building selected. Pick a floor in the explorer, then a unit — or click a unit in the 3D scene.'
            : selection.mode === 'floor'
              ? 'Floor selected. Choose a unit from the floor plan below or in the 3D scene.'
              : 'Search a ULPIN, Survey Number, Subdivision or locality — or pick a parcel / building in the 3D scene.'}
        </p>
        {isBuildingLevel && <BuildingElevationPanel query={elevQ} />}
      </aside>
    )
  }

  const u = data?.unit
  const h = data?.hierarchy
  const g = data?.governance || {}
  const vol = data?.volume || u?.volume || null
  const vval = data?.validation || null
  const vm = volumeMetrics(vol)

  const verify = async () => {
    await api.verifyUnit(selection.propertyId).catch(() => {})
    reload()
  }

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-white">Unified Property Record</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gold">
            <DemoTag label="PROTOTYPE" /> {PROTOTYPE_ID_LABEL} — not an official ULPIN
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={reset} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />

        {u && (
          <>
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5" data-testid="proto-id">
              <p className="font-mono text-[13px] font-bold text-white break-all">{u.propertyId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge status={u.status}>{u.status}</Badge>
                <Badge>{u.propertyType}</Badge>
                <Badge>{u.usage}</Badge>
              </div>
            </div>

            <Section title="Hierarchy">
              <ul className="space-y-1 text-[12px]">
                <li className="flex items-center gap-2 text-slate-300">
                  <Layers size={12} className="text-primary" /> ULPIN (Parcel):{' '}
                  <span className="font-mono text-white">{h.ulpin}</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <Building2 size={12} className="text-primary" /> Building:{' '}
                  <button className="text-white underline decoration-dotted" onClick={() => selectBuilding(h.building.id, h.ulpin)}>
                    {h.building?.name}
                  </button>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <Layers size={12} className="text-primary" /> Floor:{' '}
                  <span className="text-white">{h.floor?.label} ({h.floor?.segment})</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <Home size={12} className="text-primary" /> Unit / Apartment:{' '}
                  <span className="text-white">{h.unit?.id} · Apt {h.unit?.apartmentNumber}</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <Box size={12} className="text-primary" /> Volume ID:{' '}
                  <span className="font-mono text-white">{h.unit?.volumeId || vol?.volumeId || '—'}</span>
                </li>
              </ul>
            </Section>

            {vol && (
              <Section title="3D Geometry (Prototype)">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-gold">
                  <DemoTag label="PROTOTYPE" /> Prototype 3D Geometry — synthetic, not an official cadastral volume.
                </p>
                <KeyValue
                  data={{
                    'Volume ID': vol.volumeId || '—',
                    'Geometry Version': vol.geometryVersion ?? 1,
                    Source: vol.source || 'DEMO',
                    ...volumeBoundsRows(vol),
                    Height: vm?.heightM != null ? `${vm.heightM} m` : 'Not available',
                    'Footprint (carpet)': u.carpetAreaSqft ? `${u.carpetAreaSqft} sq.ft` : 'Not available',
                    'Est. bbox footprint': vm?.footprintM2 != null ? `${vm.footprintM2} m²` : 'Not available',
                    'Est. volume': vm?.volumeM3 != null ? `${vm.volumeM3} m³` : 'Not available',
                  }}
                />
              </Section>
            )}

            {vval && (
              <Section title="Geometry Status">
                <div className="flex items-center gap-2" data-testid="geometry-status">
                  <Badge status={geometryStatusTone(vval.status).tone === 'ok' ? 'Verified' : geometryStatusTone(vval.status).tone === 'err' ? 'Disputed' : 'Under Review'}>
                    {geometryStatusTone(vval.status).label}
                  </Badge>
                  <span className="text-[11px] text-slate-400">deterministic geometric validation</span>
                </div>
                {(vval.issues || []).length === 0 ? (
                  <p className="mt-1.5 text-[11px] text-slate-500">All checks passed within tolerance.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 text-[11px]">
                    {vval.issues.map((i, idx) => (
                      <li key={`${i.rule}-${idx}`} className="text-slate-300">
                        <span className={i.status === 'ERROR' ? 'text-danger' : 'text-gold'}>{i.status}</span>{' '}
                        <span className="font-mono text-slate-400">{i.rule}</span> — {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            <Section title="Unit Details">
              <KeyValue
                data={{
                  'Apartment Number': u.apartmentNumber,
                  Floor: u.floorLabel,
                  'Carpet Area': `${u.carpetAreaSqft} sq.ft`,
                  'Built-up Area': `${u.builtUpAreaSqft} sq.ft`,
                  Bedrooms: u.bedrooms,
                  Usage: u.usage,
                  'Construction Type': u.constructionType,
                  Facing: u.facing,
                  'Completion Year': u.completionYear,
                }}
              />
            </Section>

            <Section title="Owner Details (synthetic demo)">
              <KeyValue
                data={{
                  'Owner Name': u.owner?.name,
                  'Ownership Type': u.owner?.ownershipType,
                  'Ownership Share': `${u.owner?.sharePct}%`,
                }}
              />
              <p className="mt-1 text-[10px] text-slate-500">No real personal information — synthetic demo names only.</p>
            </Section>

            <Section title="Governance" defaultOpen={false}>
              <KeyValue
                data={{
                  Registration: g.registration?.docNumber || 'Not Available',
                  'Registered On': g.registration?.registeredOn?.slice(0, 10) || '—',
                  'Registration Status': g.registration?.status || '—',
                  Encumbrance: g.encumbrance?.type || 'Nil',
                  'EC Number': g.encumbrance?.ecNumber || '—',
                  'Property Tax': g.propertyTax?.status || 'Not Available',
                  'Tax Due': g.propertyTax ? inr(g.propertyTax.dueAmountRs) : '—',
                }}
              />
            </Section>

            <Section title="Documents" defaultOpen={false}>
              <ul className="space-y-1">
                {(data.documents || []).map((d) => (
                  <li key={d.docId} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <FileText size={12} className="text-slate-500" /> {d.category}
                    </span>
                    <a href={d.fileUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                      View
                    </a>
                  </li>
                ))}
                {(data.documents || []).length === 0 && <li className="text-[12px] text-slate-500">No documents.</li>}
              </ul>
            </Section>

            {data.disputes?.length > 0 && (
              <Section title="Disputes">
                {data.disputes.map((d) => (
                  <div key={d.disputeId} className="rounded border border-danger/30 bg-danger/10 p-2 text-[12px]">
                    <p className="font-semibold text-danger">
                      {d.type} · {d.status}
                    </p>
                    <p className="text-danger/80">{d.summary}</p>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-white/10 p-3">
        <button className="btn-ghost justify-center" onClick={() => mapApi.current.flyToUnit?.(selection.propertyId)}>
          <Crosshair size={14} /> Zoom To
        </button>
        <button
          className={clsx('justify-center', isolated ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setIsolated(!isolated)}
          data-testid="isolate-toggle"
        >
          <Focus size={14} /> {isolated ? 'Exit Isolation' : 'Isolate Unit'}
        </button>
        {can('property:verify') && (
          <button className="btn-ghost col-span-2 justify-center" onClick={verify} disabled={u?.status === 'Verified'}>
            <ShieldCheck size={14} /> {u?.status === 'Verified' ? 'Verified' : 'Verify Unit'}
          </button>
        )}
        <button className="btn-ghost justify-center" onClick={() => navigator.clipboard?.writeText(selection.propertyId)}>
          <Share2 size={14} /> Share ID
        </button>
        <button className="btn-ghost justify-center" onClick={() => setNote(note ? '' : ' ')}>
          <StickyNote size={14} /> Add Note
        </button>
        {note !== '' && (
          <textarea
            className="input col-span-2 mt-1 text-xs"
            rows={2}
            placeholder="Private note (prototype — not persisted)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </footer>
    </aside>
  )
}

// --------------------------------------------------------------------------
// Building elevation panel (Phase 5, additive). Shown under the building/floor
// placeholder in the main sidebar — ground / roof / height / source /
// confidence / quality per spec section 22, or an explicit "Unavailable" with
// a reason when no elevation dataset has been processed for this building.
// --------------------------------------------------------------------------
function BuildingElevationPanel({ query }) {
  const { data: h, loading } = query
  if (loading) return <div className="mt-3"><Spinner /></div>
  if (!h) return null

  if (h.dataAvailability === 'UNAVAILABLE') {
    return (
      <div className="mt-3 rounded-lg border border-white/10 p-2.5" data-testid="elevation-unavailable">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Mountain size={12} /> Building Height
        </p>
        <p className="mt-1 text-[12px] text-slate-300">Unavailable</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Reason: {h.reason}</p>
      </div>
    )
  }

  const qtone = h.qualityStatus === 'VALID' ? 'Verified' : h.qualityStatus === 'ERROR' ? 'Disputed' : 'Under Review'
  return (
    <div className="mt-3 rounded-lg border border-gold/30 bg-gold/10 p-2.5" data-testid="elevation-height-panel">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-gold">
        <Mountain size={12} /> Elevation-Derived Height <DemoTag label="ELEVATION_DEMO" />
      </p>
      <KeyValue
        data={{
          'Building Height': h.buildingHeightM != null ? `${h.buildingHeightM} m` : 'Unavailable',
          Ground: h.groundElevationM != null ? `${h.groundElevationM} m` : '—',
          Roof: h.roofElevationM != null ? `${h.roofElevationM} m` : '—',
          Source: h.dataSource || '—',
          Confidence: h.confidenceLevel || '—',
        }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Badge status={qtone}>{h.qualityStatus}</Badge>
        {h.appliedToBuilding && <span className="text-[10px] text-emerald-400">Applied to 3D extrusion</span>}
      </div>
      {(h.qualityIssues || []).length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300">
          {h.qualityIssues.slice(0, 3).map((i, idx) => (
            <li key={idx}><span className={i.status === 'ERROR' ? 'text-danger' : 'text-gold'}>{i.status}</span> {i.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Parcel view — shows the ULPIN with an explicit OFFICIAL / DEMO distinction
// and full data provenance. (Phase 1: all parcels are DEMO.)
// --------------------------------------------------------------------------
function ParcelCard({ query, ulpin, mapApi, onClose, canVerify }) {
  const { data, error, loading, reload } = query
  const p = data?.parcel
  const prov = data?.provenance || {}
  const badge = verificationBadge(prov.verificationStatus)
  const official = isOfficial(prov.verificationStatus)
  const coord = p?.centroid?.coordinates
  const gov = data?.providerChain?.find((c) => c.provider === 'GovernmentDataProvider')

  const verify = async () => {
    await api.verifyParcel(ulpin).catch(() => {})
    reload()
  }

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-white">Land Parcel Record</p>
          <p
            className={clsx(
              'mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold',
              official ? 'text-emerald-400' : 'text-gold',
            )}
            data-testid="parcel-verification"
          >
            {official ? <BadgeCheck size={12} /> : <TriangleAlert size={12} />}
            {badge.text}
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="parcel-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />

        {p && (
          <>
            <div
              className={clsx(
                'rounded-lg border p-2.5',
                official ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-gold/30 bg-gold/10',
              )}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {official ? 'ULPIN (Official — Government Source)' : 'Parcel ID (Demo — Not an Official ULPIN)'}
              </p>
              <p className="mt-0.5 font-mono text-[13px] font-bold text-white break-all" data-testid="parcel-ulpin">
                {p.ulpin}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!official && <DemoTag label="DEMO" />}
                <Badge status={p.status}>{p.status}</Badge>
                {p.landUse && <Badge>{p.landUse}</Badge>}
              </div>
            </div>

            <Section title="Parcel Identification">
              <KeyValue
                data={{
                  ULPIN: p.ulpin,
                  Status: badge.short,
                  'ULPIN Status': prov.ulpinStatus || '—',
                  'Parcel ID': p.parcelId,
                  'Survey Number': p.surveyNumber || '—',
                  Subdivision: p.subdivisionNumber || p.subDivision || '—',
                  'Record Type': prov.recordType || p.recordType || '—',
                }}
              />
            </Section>

            <Section title="Location">
              <KeyValue
                data={{
                  Locality: p.village || p.locality || '—',
                  Taluk: p.taluk || '—',
                  District: p.district || '—',
                  Zone: p.zone || '—',
                  Ward: p.ward || '—',
                  Area: p.areaSqft ? `${p.areaSqft.toLocaleString('en-IN')} sq.ft (${p.areaSqm?.toLocaleString('en-IN')} sq.m)` : '—',
                  Coordinates: coord ? `${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}` : '—',
                }}
              />
            </Section>

            <Section title="Data Source & Provenance">
              <KeyValue
                data={{
                  Source: prov.sourceOrganization || '—',
                  Dataset: prov.sourceDataset || '—',
                  'Retrieved At': prov.retrievedAt ? prov.retrievedAt.slice(0, 19).replace('T', ' ') : '—',
                  'Verification': badge.short,
                }}
              />
              {prov.sourceUrl ? (
                <a
                  href={prov.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <ExternalLink size={11} /> {prov.sourceUrl}
                </a>
              ) : (
                <p className="mt-1 text-[10px] text-slate-500">
                  {gov?.reason
                    ? `Government source: ${gov.reason}`
                    : 'No government source link — synthetic demo record.'}
                </p>
              )}
              {prov.disclaimer && (
                <p className="mt-1 text-[10px] text-gold/90">{prov.disclaimer}</p>
              )}
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-white/10 p-3">
        <button className="btn-ghost justify-center" onClick={() => mapApi.current.flyToParcel?.(ulpin)}>
          <MapPin size={14} /> Zoom To
        </button>
        <button className="btn-ghost justify-center" onClick={() => navigator.clipboard?.writeText(ulpin)}>
          <Share2 size={14} /> Copy ID
        </button>
        {canVerify && (
          <button
            className="btn-ghost col-span-2 justify-center"
            onClick={verify}
            disabled={p?.status === 'Verified'}
          >
            <ShieldCheck size={14} /> {p?.status === 'Verified' ? 'Verified (demo)' : 'Verify Parcel (demo)'}
          </button>
        )}
      </footer>
    </aside>
  )
}

// --------------------------------------------------------------------------
// AI-extracted building (Phase 3). MODEL OUTPUT / AI_DEMO — a candidate
// geometry only. It is never an official cadastral / ULPIN / survey record and
// confers no ownership or rights.
// --------------------------------------------------------------------------
function AiBuildingCard({ query, id, onClose, canReview }) {
  const { data: b, error, loading, reload } = query
  const [busy, setBusy] = useState(false)

  const setReview = async (status) => {
    setBusy(true)
    await api.aiBuildingReview(id, status).catch(() => {})
    setBusy(false)
    reload()
  }

  const level = b?.confidenceLevel
  const gtone = b?.geometryStatus === 'VALID' ? 'Verified' : b?.geometryStatus === 'ERROR' ? 'Disputed' : 'Under Review'

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-white">AI-Extracted Building</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-gold" data-testid="ai-building-source">
            <DemoTag label="AI_DEMO" /> MODEL OUTPUT — not an official record
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="ai-building-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {b && (
          <>
            <div className="rounded-lg border border-gold/30 bg-gold/10 p-2.5">
              <p className="font-mono text-[13px] font-bold text-white break-all">{b.aiBuildingId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <DemoTag label="AI / PROTOTYPE" />
                <Badge>{level}</Badge>
                <Badge status={gtone}>{b.geometryStatus}</Badge>
              </div>
            </div>

            <Section title="Model">
              <KeyValue
                data={{
                  Source: b.source,
                  Model: b.modelName || b.model,
                  'Model Version': b.modelVersion,
                  Confidence: b.confidence != null ? `${(b.confidence * 100).toFixed(1)}%` : '—',
                  'Confidence Level': level,
                  Timestamp: b.timestamp ? b.timestamp.slice(0, 19).replace('T', ' ') : '—',
                }}
              />
            </Section>

            <Section title="Geometry">
              <KeyValue
                data={{
                  'Geometry Status': b.geometryStatus,
                  Georeferenced: b.georeferenced ? `Yes (${b.geoStatus})` : `No (${b.geoStatus})`,
                  'Area (est.)': b.areaM2 != null ? `${b.areaM2} m²` : b.areaPx != null ? `${b.areaPx} px²` : 'Not available',
                  Height: 'Not available',
                  'Height Status': b.heightStatus,
                }}
              />
              {(b.geometryIssues || []).length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300">
                  {b.geometryIssues.map((m, i) => (
                    <li key={i}><span className="text-gold">•</span> {m}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-gold/90">Height shown in 3D is an ESTIMATED / DEMO value — not survey / LiDAR / GNSS-derived.</p>
            </Section>

            <Section title="Parcel Association">
              <KeyValue
                data={{
                  Status: b.parcelStatus,
                  'Parent Parcel': b.parentParcelId || (b.parcelStatus === 'MULTI_PARCEL' ? 'multiple — see candidates' : '—'),
                  'Parent ULPIN': b.parentULPIN || '—',
                  'ULPIN Status': b.ulpinStatus,
                }}
              />
              {(b.parcelCandidates || []).length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300" data-testid="ai-parcel-candidates">
                  {b.parcelCandidates.map((c) => (
                    <li key={c.parcelId}>
                      <span className="font-mono">{c.parcelId}</span>
                      {c.ulpin ? <span className="text-slate-500"> · {c.ulpin}</span> : null}
                      <span className="text-slate-500"> · {Math.round((c.overlapRatio || 0) * 100)}% overlap</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Review">
              <div className="flex items-center gap-2" data-testid="ai-review-status">
                <Badge status={b.reviewStatus === 'ACCEPTED' ? 'Verified' : b.reviewStatus === 'REJECTED' ? 'Disputed' : 'Under Review'}>
                  {b.reviewStatus}
                </Badge>
                {b.reviewRequired && <span className="text-[11px] text-gold">Requires Review</span>}
              </div>
              {canReview ? (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('ACCEPTED')}>Accept</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('REJECTED')}>Reject</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('NEEDS_CORRECTION')}>Correct</button>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-slate-500">Review requires the change-detection:review permission.</p>
              )}
              <p className="mt-1.5 text-[10px] text-gold/90">
                An AI prediction is a decision-support candidate only. It creates no ownership, rights or official cadastral record.
              </p>
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}

// --------------------------------------------------------------------------
// AI floor-plan-derived apartment / property unit (Phase 4). MODEL OUTPUT /
// AI_DEMO / DEMO_RESEARCH_DATA (dataset: CubiCasa5K). An AI-inferred apartment
// boundary — never an official cadastral / ULPIN / ownership record. Reuses the
// existing viewer, camera, isolation and sidebar.
// --------------------------------------------------------------------------
function AiFloorUnitCard({ query, id, onClose, mapApi, canReview }) {
  const { isolated, setIsolated } = useSelection()
  const { data: u, error, loading, reload } = query
  const [busy, setBusy] = useState(false)

  const setReview = async (status) => {
    setBusy(true)
    await api.aiFloorUnitReview(id, status).catch(() => {})
    setBusy(false)
    reload()
  }

  const level = u?.confidenceLevel
  const gtone = u?.geometryStatus === 'VALID' ? 'Verified' : u?.geometryStatus === 'ERROR' ? 'Disputed' : 'Under Review'
  const vol = u?.volume || null

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-white">AI Floor-Plan Unit</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-gold" data-testid="ai-floor-unit-source">
            <DemoTag label="AI_DEMO" /> MODEL OUTPUT · DEMO_RESEARCH_DATA — not an official record
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="ai-floor-unit-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {u && (
          <>
            <div className="rounded-lg border border-gold/30 bg-gold/10 p-2.5">
              <p className="font-mono text-[13px] font-bold text-white break-all">{u.localUnitId || u.aiFloorUnitId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <DemoTag label="AI / PROTOTYPE" />
                <Badge>{level}</Badge>
                <Badge status={gtone}>{u.geometryStatus}</Badge>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Prototype unit identifier — <strong>not</strong> an official ULPIN.
              </p>
            </div>

            <Section title="Model & Dataset">
              <KeyValue
                data={{
                  Source: u.source,
                  Classification: u.dataClassification || 'DEMO_RESEARCH_DATA',
                  Dataset: u.dataset || 'CubiCasa5K',
                  Model: u.model,
                  'Model Version': u.modelVersion,
                  Confidence: u.confidence != null ? `${(u.confidence * 100).toFixed(1)}%` : '—',
                  'Confidence Level': level,
                  Timestamp: u.timestamp ? u.timestamp.slice(0, 19).replace('T', ' ') : '—',
                }}
              />
            </Section>

            <Section title="Composition">
              <KeyValue
                data={{
                  Rooms: (u.rooms || []).length,
                  Types: (u.roomTypes || []).join(', ') || '—',
                  Area: u.area != null ? `${u.area} ${u.areaUnit === 'M2' ? 'm²' : 'px²'}` : 'Not available',
                  'Area Status': u.areaStatus,
                }}
              />
              {(u.roomDetails || []).length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-300">
                  {u.roomDetails.map((r) => (
                    <li key={r.roomId}>
                      <span className="font-mono text-slate-400">{r.localRoomId}</span> · {r.roomType || r.class}
                      {r.reviewRequired && <span className="text-gold"> · review</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Geometry & Placement">
              <KeyValue
                data={{
                  'Geometry Status': u.geometryStatus,
                  Placement: u.georeferenced ? `On map (${u.geoStatus})` : `Local only (${u.geoStatus})`,
                  Building: u.buildingId || '—',
                  Floor: u.floorId || '—',
                  'Parent Parcel': u.parentParcelId || '—',
                  'Parent ULPIN': u.parentULPIN || '—',
                  'ULPIN Status': u.ulpinStatus,
                }}
              />
              {(u.ambiguityReasons || []).length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300">
                  {u.ambiguityReasons.map((m, i) => (
                    <li key={i}><span className="text-gold">•</span> {m}</li>
                  ))}
                </ul>
              )}
            </Section>

            {vol && (
              <Section title="3D Volume (Prototype, Phase 2 model)">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-gold">
                  <DemoTag label="ESTIMATED / DEMO" /> Reuses the Phase-2 prototype volume model.
                </p>
                <KeyValue
                  data={{
                    'Volume ID': vol.volumeId || '—',
                    'X min': Number.isFinite(vol.xmin) ? vol.xmin.toFixed(6) : '—',
                    'X max': Number.isFinite(vol.xmax) ? vol.xmax.toFixed(6) : '—',
                    'Y min': Number.isFinite(vol.ymin) ? vol.ymin.toFixed(6) : '—',
                    'Y max': Number.isFinite(vol.ymax) ? vol.ymax.toFixed(6) : '—',
                    'Z min': Number.isFinite(vol.zmin) ? `${vol.zmin} m` : '—',
                    'Z max': Number.isFinite(vol.zmax) ? `${vol.zmax} m` : '—',
                    'Height Status': u.heightStatus,
                  }}
                />
                {u.volumeValidation && (
                  <div className="mt-1.5" data-testid="ai-floor-unit-geometry-status">
                    <Badge status={u.volumeValidation.status === 'VALID' ? 'Verified' : u.volumeValidation.status === 'ERROR' ? 'Disputed' : 'Under Review'}>
                      {u.volumeValidation.status}
                    </Badge>
                    {(u.volumeValidation.issues || []).map((it, i) => (
                      <p key={i} className="mt-1 text-[11px] text-slate-300">
                        <span className={it.status === 'ERROR' ? 'text-danger' : 'text-gold'}>{it.status}</span>{' '}
                        <span className="font-mono text-slate-400">{it.rule}</span> — {it.message}
                      </p>
                    ))}
                  </div>
                )}
              </Section>
            )}

            <Section title="Review">
              <div className="flex items-center gap-2" data-testid="ai-floor-unit-review-status">
                <Badge status={u.reviewStatus === 'ACCEPTED' ? 'Verified' : u.reviewStatus === 'REJECTED' ? 'Disputed' : 'Under Review'}>
                  {u.reviewStatus}
                </Badge>
                {u.reviewRequired && <span className="text-[11px] text-gold">Requires Review</span>}
              </div>
              {canReview ? (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('ACCEPTED')}>Accept</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('REJECTED')}>Reject</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('NEEDS_CORRECTION')}>Correct</button>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-slate-500">Review requires the change-detection:review permission.</p>
              )}
              <p className="mt-1.5 text-[10px] text-gold/90">
                AI-inferred apartment boundary. Human review is required for any authoritative use; it creates no ownership,
                rights or official cadastral record, and never an official ULPIN.
              </p>
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-white/10 p-3">
        <button className="btn-ghost justify-center" onClick={() => mapApi.current.flyToAiFloorUnit?.(id)}>
          <Crosshair size={14} /> Zoom To
        </button>
        <button
          className={clsx('justify-center', isolated ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setIsolated(!isolated)}
          data-testid="ai-floor-unit-isolate"
        >
          <Focus size={14} /> {isolated ? 'Exit Isolation' : 'Isolate Unit'}
        </button>
      </footer>
    </aside>
  )
}

// --------------------------------------------------------------------------
// GNSS/CORS control point (Phase 6). GNSS/CORS DEMO / MODEL OUTPUT — a
// control-point observation from an uploaded, demonstration, research or
// survey dataset. Never an official cadastral control point or
// government-authoritative survey record, and accuracy is only ever shown
// when the dataset itself supplied a number.
// --------------------------------------------------------------------------
function GnssPointCard({ query, elevQuery, id, onClose, mapApi, canReview }) {
  const { data: p, error, loading, reload } = query
  const { data: elev } = elevQuery || {}
  const [busy, setBusy] = useState(false)

  const setReview = async (action) => {
    setBusy(true)
    await api.gnssReview(id, action).catch(() => {})
    setBusy(false)
    reload()
  }

  const vtone = p?.validationStatus === 'VALID' ? 'Verified' : p?.validationStatus === 'ERROR' ? 'Disputed' : 'Under Review'
  const ptone = p?.parcelStatus === 'MATCHED' ? 'Verified' : p?.parcelStatus === 'OUTSIDE_PARCEL' ? 'Disputed' : 'Under Review'

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-white">GNSS/CORS Control Point</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-gold" data-testid="gnss-point-source">
            <DemoTag label="GNSS/CORS DEMO" /> MODEL OUTPUT — not an official survey record
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="gnss-point-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {p && (
          <>
            <div className="rounded-lg border border-gold/30 bg-gold/10 p-2.5">
              <p className="font-mono text-[13px] font-bold text-white break-all">{p.controlPointId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <DemoTag label={p.source} />
                <Badge status={vtone}>{p.validationStatus}</Badge>
              </div>
            </div>

            <Section title="Coordinates &amp; Height">
              <KeyValue
                data={{
                  Latitude: p.resolvedLatitude ?? p.latitude ?? '—',
                  Longitude: p.resolvedLongitude ?? p.longitude ?? '—',
                  Height: p.height != null ? `${p.height} m` : 'Not available',
                  CRS: p.coordinateReferenceSystem || 'Unknown',
                  'CRS Status': p.crsStatus,
                  Timestamp: p.timestamp ? String(p.timestamp).slice(0, 19).replace('T', ' ') : 'Not available',
                }}
              />
            </Section>

            <Section title="Survey Metadata">
              <KeyValue
                data={{
                  Source: p.source,
                  'Survey Method': p.surveyMethod || '—',
                  'Reported Accuracy': p.accuracy != null ? `${p.accuracy} ${p.accuracyUnit || 'm'}` : 'Not available',
                  'Accuracy Status': p.accuracyStatus,
                  'Fix Status': p.fixStatus || '—',
                  Operator: p.operator || '—',
                }}
              />
              <p className="mt-1.5 text-[10px] text-gold/90">
                {p.accuracy != null
                  ? `Reported accuracy: ${p.accuracy} ${p.accuracyUnit || 'm'}. Validation status: UNVERIFIED unless independently confirmed.`
                  : 'Reported accuracy: Not available. Survey accuracy is not claimed for this point.'}
              </p>
            </Section>

            <Section title="Validation">
              <div className="flex items-center gap-2" data-testid="gnss-validation-status">
                <Badge status={vtone}>{p.validationStatus}</Badge>
              </div>
              {(p.validationIssues || []).length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300">
                  {p.validationIssues.map((i, idx) => (
                    <li key={idx}>
                      <span className={i.status === 'ERROR' ? 'text-danger' : 'text-gold'}>{i.status}</span>{' '}
                      <span className="font-mono text-slate-400">{i.rule}</span> — {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Parcel Association">
              <div className="flex items-center gap-2">
                <Badge status={ptone}>{p.parcelStatus}</Badge>
              </div>
              <KeyValue
                data={{
                  'Parent Parcel': p.parentParcelId || '—',
                  'Parent ULPIN': p.parentULPIN || '—',
                  'Association Confidence': p.associationConfidence != null ? `${Math.round(p.associationConfidence * 100)}%` : '—',
                  'Nearest Boundary': p.nearestBoundaryM != null ? `${p.nearestBoundaryM} m` : '—',
                }}
              />
              <p className="mt-1 text-[10px] text-slate-500">A control point never creates or changes a ULPIN.</p>
            </Section>

            <Section title="DEM/DSM Elevation Residual">
              {elev?.dataAvailability === 'AVAILABLE' ? (
                <>
                  <KeyValue
                    data={{
                      'Observed Elevation (GNSS)': `${elev.observedElevation} m`,
                      'Model Elevation': `${elev.modelElevation} m`,
                      'Model Source': elev.modelSource,
                      Residual: `${elev.elevationResidualM} m`,
                      'Vertical Datum': elev.verticalDatumStatus,
                    }}
                  />
                  <p className="mt-1.5 text-[10px] text-gold/90">
                    Observed difference only — this does not mean the GNSS reading or the DEM/DSM model is "correct".
                    {elev.verticalDatumStatus !== 'MATCHED' && ' Vertical datum is not confirmed matched, which limits comparability.'}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-slate-500" data-testid="gnss-elevation-unavailable">
                  {elev?.reason || 'No DEM/DSM-derived elevation is available for comparison at this control point.'}
                </p>
              )}
            </Section>

            <Section title="Review">
              <div className="flex items-center gap-2" data-testid="gnss-review-status">
                <Badge status={p.verificationStatus === 'ACCEPTED' ? 'Verified' : p.verificationStatus === 'REJECTED' ? 'Disputed' : 'Under Review'}>
                  {p.verificationStatus || 'UNVERIFIED'}
                </Badge>
              </div>
              {canReview ? (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('ACCEPTED')}>Accept</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => setReview('REJECTED')}>Reject</button>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-slate-500">Review requires the change-detection:review permission.</p>
              )}
              <p className="mt-1.5 text-[10px] text-gold/90">
                GNSS/CORS DEMO / MODEL OUTPUT — not automatically an official cadastral control point. Existing parcel
                geometry is never overwritten without explicit authorized review.
              </p>
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-1 gap-1.5 border-t border-white/10 p-3">
        <button className="btn-ghost justify-center" onClick={() => mapApi.current.flyToGnssPoint?.(id)}>
          <Satellite size={14} /> Zoom To
        </button>
      </footer>
    </aside>
  )
}
