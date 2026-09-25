import { Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  X, Crosshair, Focus, ShieldCheck, FileText, Share2, StickyNote, Building2, Layers, Home,
  BadgeCheck, TriangleAlert, MapPin, ExternalLink, Box, Mountain, Satellite, Waypoints,
  Fingerprint, Copy,
} from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApi } from '../../lib/useApi.js'
import { api } from '../../lib/api.js'
import { Badge, DemoTag, KeyValue, Spinner, ErrorNote } from '../ui/primitives.jsx'
import { inr, formatUlpinDisplay } from '../../lib/format.js'
import { PROTOTYPE_ID_LABEL, LOCALITIES_FALLBACK, COIMBATORE_DEMO_PROPERTY } from '../../lib/constants.js'
import { verificationBadge, isOfficial } from '../../lib/provenance.js'
import { volumeMetrics, volumeBoundsRows, geometryStatusTone } from '../../lib/volume.js'
import { buildParcelCertificate, buildBuildingCertificate, buildUnitCertificate } from '../../lib/certificate.js'
import { lazyWithRetry } from '../../lib/lazyWithRetry.js'
import { GenerateThreeDUlpinDialog } from './GenerateThreeDUlpinDialog.jsx'

// The certificate modal pulls in jsPDF + a QR-code generator (~350KB) — kept
// out of the app's eagerly-loaded main bundle and fetched only the first time
// a user actually opens a certificate, same pattern as the standalone 3D
// explorer routes (see lib/lazyWithRetry.js / App.jsx).
const PropertyCertificateModal = lazyWithRetry(
  () => import('../certificate/PropertyCertificateModal.jsx').then((m) => ({ default: m.PropertyCertificateModal })),
  'PropertyCertificateModal',
)

function CertificateModalFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
      <div className="rounded-lg bg-surface px-4 py-3 shadow-xl">
        <Spinner label="Preparing certificate…" />
      </div>
    </div>
  )
}

// Deep link into the standalone detailed 3D Building Explorer (opens in a new
// tab). Short hierarchy segments per the documented contract; the explorer
// re-fetches from the same backend, so no data is duplicated.
function explorerUrl({ ulpin, buildingSeg, floorSeg, unitId }) {
  const loc = LOCALITIES_FALLBACK.find((l) => l.ulpinPrimary === ulpin)
  const q = new URLSearchParams({ ulpin })
  if (loc) q.set('area', loc.id)
  if (buildingSeg) q.set('buildingId', buildingSeg)
  if (floorSeg) q.set('floorId', floorSeg)
  if (unitId) q.set('unitId', unitId)
  return `/3d-explorer?${q.toString()}`
}

// Deep link into the standalone Underground Infrastructure 3D Explorer (opens
// in a new tab). Re-reads the same Phase 8 backend — no data is duplicated.
function undergroundUrl({ area, ulpin, infrastructureId }) {
  const loc = area || LOCALITIES_FALLBACK.find((l) => l.ulpinPrimary === ulpin)?.id
  const q = new URLSearchParams()
  if (loc) q.set('area', loc)
  if (ulpin) q.set('ulpin', ulpin)
  if (infrastructureId) q.set('infrastructureId', infrastructureId)
  return `/underground-explorer?${q.toString()}`
}

// Deep link into the standalone Coimbatore 3D Property Explorer (opens in a
// new tab, exactly like the other two explorers above) — lazy-loads the
// user-provided ODM textured model only once the user gets there.
const COIMBATORE_EXPLORER_URL = '/coimbatore-explorer'

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-slate-200 py-2">
      <button className="flex w-full items-center justify-between py-1 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="section-title">{title}</span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  )
}

export function PropertySidebar() {
  const { selection, isolated, setIsolated, reset, mapApi, selectBuilding, selectParcel } = useSelection()
  const { can, user } = useAuth()
  const [note, setNote] = useState('')
  const [showCert, setShowCert] = useState(false)
  const [showGen3D, setShowGen3D] = useState(false)
  const [gen3DBusy, setGen3DBusy] = useState(false)

  const isUnit = selection.mode === 'unit' && selection.propertyId
  const isParcel = selection.mode === 'parcel' && !!selection.ulpin
  const isAi = selection.mode === 'ai-building' && !!selection.aiBuildingId
  const isAiFp = selection.mode === 'ai-floor-unit' && !!selection.aiFloorUnitId
  const isGnss = selection.mode === 'gnss-point' && !!selection.controlPointId
  const isInfra = selection.mode === 'infrastructure' && !!selection.infrastructureId
  const isTngis = selection.mode === 'tngis-parcel' && !!selection.sourceRecordId
  const isCoimbatoreDemo = selection.mode === 'coimbatore-demo'
  const isBuildingLevel = (selection.mode === 'building' || selection.mode === 'floor') && !!selection.buildingId
  const { data, error, loading, reload } = useApi(
    () => (isUnit ? api.unit(selection.propertyId) : Promise.resolve(null)),
    [isUnit, selection.propertyId],
  )
  // Phase 9 — Proposed 3D Property Identifier(s) linked to this unit, if any.
  const idQ = useApi(
    () => (isUnit ? api.identifierList({ propertyId: selection.propertyId }).catch(() => []) : Promise.resolve([])),
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
  const infraQ = useApi(
    () => (isInfra ? api.infrastructure(selection.infrastructureId) : Promise.resolve(null)),
    [isInfra, selection.infrastructureId],
  )
  const infraRelQ = useApi(
    () => (isInfra ? api.infrastructureRelations(selection.infrastructureId).catch(() => null) : Promise.resolve(null)),
    [isInfra, selection.infrastructureId],
  )
  const infraElevQ = useApi(
    () => (isInfra ? api.infrastructureElevation(selection.infrastructureId).catch(() => null) : Promise.resolve(null)),
    [isInfra, selection.infrastructureId],
  )
  // TNGIS / Tamil Nilam — the selected PUBLIC-source parcel, its building
  // spatial relationships and a Phase 7 topology run over its geometry.
  const tngisQ = useApi(
    () => (isTngis ? api.tngisParcel(selection.sourceRecordId) : Promise.resolve(null)),
    [isTngis, selection.sourceRecordId],
  )
  const tngisRelQ = useApi(
    () => (isTngis ? api.tngisParcelRelations(selection.sourceRecordId).catch(() => null) : Promise.resolve(null)),
    [isTngis, selection.sourceRecordId],
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
  // Authoritative building record for the building/floor placeholder — id,
  // ULPIN, locality, floor/unit counts, height and prototype volume.
  const buildingQ = useApi(
    () => (isBuildingLevel ? api.building(selection.buildingId).catch(() => null) : Promise.resolve(null)),
    [isBuildingLevel, selection.buildingId],
  )
  // Coimbatore demonstration property — backed by a real `buildings` document
  // (buildingId COIMBATORE-DEMO-001, see backend/src/data/seed.js) so its
  // official ULPIN/land-record fields and any generated 3D ULPIN persist in
  // MongoDB and are visible to every role, exactly like a regular building.
  const coimbatoreQ = useApi(
    () => (isCoimbatoreDemo ? api.building(COIMBATORE_DEMO_PROPERTY.propertyId).catch(() => null) : Promise.resolve(null)),
    [isCoimbatoreDemo],
  )

  if (!isUnit) {
    if (isParcel) {
      return <ParcelCard query={parcelQ} ulpin={selection.ulpin} mapApi={mapApi} onClose={reset} canVerify={can('parcel:verify')} generatedBy={user} />
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
    if (isInfra) {
      return <InfrastructureCard query={infraQ} relQuery={infraRelQ} elevQuery={infraElevQ} id={selection.infrastructureId} onClose={reset} mapApi={mapApi} canReview={can('infrastructure:review')} />
    }
    if (isTngis) {
      return <TngisParcelCard query={tngisQ} relQuery={tngisRelQ} id={selection.sourceRecordId} onClose={reset} mapApi={mapApi} canValidate={can('topology:validate')} />
    }
    if (isCoimbatoreDemo) {
      return <CoimbatoreDemoCard query={coimbatoreQ} onClose={reset} generatedBy={user} can3dUlpin={can('3dulpin:create')} />
    }
    if (isBuildingLevel) {
      return (
        <BuildingCard
          query={buildingQ}
          elevQuery={elevQ}
          mode={selection.mode}
          buildingId={selection.buildingId}
          mapApi={mapApi}
          onClose={reset}
          onSelectParcel={selectParcel}
          generatedBy={user}
          can3dUlpin={can('3dulpin:create')}
        />
      )
    }
    return (
      <aside className="pointer-events-auto absolute right-3 top-3 z-30 w-80 panel p-4" data-testid="property-sidebar">
        <p className="section-title">Property / Unit Details</p>
        <p className="mt-2 text-sm text-slate-500">
          Search a ULPIN, Survey Number, Subdivision or locality — or pick a parcel / building in the 3D scene.
        </p>
      </aside>
    )
  }

  const u = data?.unit
  const h = data?.hierarchy
  const g = data?.governance || {}
  const vol = data?.volume || u?.volume || null
  const vval = data?.validation || null
  const vm = volumeMetrics(vol)
  const cert = u ? buildUnitCertificate({ unitData: data, generatedBy: user }) : null

  const verify = async () => {
    await api.verifyUnit(selection.propertyId).catch(() => {})
    reload()
  }

  const generate3D = async () => {
    setGen3DBusy(true)
    try {
      await api.generateUnitThreeDUlpin(selection.propertyId).catch(() => {})
      await reload()
    } finally {
      setGen3DBusy(false)
      setShowGen3D(false)
    }
  }

  return (
    <>
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">Unified Property Record</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-warn">
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
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all">{u.propertyId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge status={u.status}>{u.status}</Badge>
                <Badge>{u.propertyType}</Badge>
                <Badge>{u.usage}</Badge>
              </div>
            </div>

            <Section title="Hierarchy">
              <ul className="space-y-1 text-[12px]">
                <li className="flex items-center gap-2 text-slate-600">
                  <Layers size={12} className="text-primary" /> ULPIN (Parcel):{' '}
                  <span className="data-mono text-slate-900">{formatUlpinDisplay(h.ulpin)}</span>
                </li>
                <li className="flex items-center gap-2 text-slate-600">
                  <Building2 size={12} className="text-primary" /> Building:{' '}
                  <button className="text-slate-900 underline decoration-dotted" onClick={() => selectBuilding(h.building.id, h.ulpin)}>
                    {h.building?.name}
                  </button>
                </li>
                <li className="flex items-center gap-2 text-slate-600">
                  <Layers size={12} className="text-primary" /> Floor:{' '}
                  <span className="text-slate-900">{h.floor?.label} ({h.floor?.segment})</span>
                </li>
                <li className="flex items-center gap-2 text-slate-600">
                  <Home size={12} className="text-primary" /> Unit / Apartment:{' '}
                  <span className="text-slate-900">{h.unit?.id} · Apt {h.unit?.apartmentNumber}</span>
                </li>
                <li className="flex items-center gap-2 text-slate-600">
                  <Fingerprint size={12} className="text-primary" /> 3D ULPIN:{' '}
                  {u.threeDUlpin ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="data-mono text-slate-900" title="System Generated 3D Property Identifier">{u.threeDUlpin}</span>
                      <button
                        className="text-slate-400 hover:text-slate-700"
                        onClick={() => navigator.clipboard?.writeText(u.threeDUlpin)}
                        aria-label="Copy 3D ULPIN"
                        title="Copy 3D ULPIN"
                        type="button"
                      >
                        <Copy size={11} />
                      </button>
                    </span>
                  ) : (
                    <span className="text-slate-500">Not generated</span>
                  )}
                </li>
                <li className="flex items-center gap-2 text-slate-600">
                  <Box size={12} className="text-primary" /> Volume ID:{' '}
                  <span className="font-mono text-slate-900">{h.unit?.volumeId || vol?.volumeId || '—'}</span>
                </li>
              </ul>
            </Section>

            {(idQ.data || []).length > 0 && (
              <Section title="Proposed 3D Property Identifier">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-warn">
                  <DemoTag label="PROPOSED / RESEARCH" /> Not an Official ULPIN · not a government-approved 3D ULPIN standard.
                </p>
                <div data-testid="sidebar-identifier">
                  {idQ.data.map((r) => (
                    <div key={r.identifierId} className="mb-1 rounded border border-warn/30 bg-warn/10 p-2 text-[11px]">
                      <p className="font-mono text-slate-900 break-all">{r.canonicalIdentifier}</p>
                      <p className="mt-0.5 text-slate-500">
                        Official ULPIN: <span className="font-mono text-slate-900">{r.officialULPIN || 'NOT AVAILABLE'}</span> · {r.geometryVersion} · {r.status}
                      </p>
                    </div>
                  ))}
                </div>
                <Link to="/identifier" className="text-[11px] text-primary underline">Open the 3D Property Identifier page →</Link>
              </Section>
            )}

            {vol && (
              <Section title="3D Geometry (Prototype)">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-warn">
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
                  <span className="text-[11px] text-slate-500">deterministic geometric validation</span>
                </div>
                {(vval.issues || []).length === 0 ? (
                  <p className="mt-1.5 text-[11px] text-slate-500">All checks passed within tolerance.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 text-[11px]">
                    {vval.issues.map((i, idx) => (
                      <li key={`${i.rule}-${idx}`} className="text-slate-600">
                        <span className={i.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{i.status}</span>{' '}
                        <span className="font-mono text-slate-500">{i.rule}</span> — {i.message}
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
                    <span className="flex items-center gap-1.5 text-slate-600">
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
                  <div key={d.disputeId} className="rounded border border-danger/30 bg-danger/5 p-2 text-[12px]">
                    <p className="font-semibold text-danger">
                      {d.type} · {d.status}
                    </p>
                    <p className="text-red-700">{d.summary}</p>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-slate-200 p-3">
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
        {can('3dulpin:create') && (
          u?.threeDUlpin ? (
            <p className="col-span-2 flex items-center justify-center gap-1.5 rounded-md border border-teal/30 bg-teal/10 px-2 py-1.5 text-xs font-semibold text-teal">
              <Fingerprint size={13} /> Already Generated
            </p>
          ) : (
            <button
              className="btn-ghost col-span-2 justify-center"
              onClick={() => setShowGen3D(true)}
              data-testid="generate-3d-ulpin"
            >
              <Fingerprint size={14} /> Generate 3D ULPIN
            </button>
          )
        )}
        <a
          href={explorerUrl({
            ulpin: h?.ulpin,
            buildingSeg: h?.building?.segment,
            floorSeg: h?.floor?.segment,
            unitId: h?.unit?.id,
          })}
          target="_blank"
          className="btn-ghost col-span-2 justify-center"
          data-testid="open-3d-explorer"
        >
          <Box size={14} /> Open 3D Building Explorer
        </a>
        <a
          href={undergroundUrl({ ulpin: h?.ulpin })}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost col-span-2 justify-center"
          data-testid="open-underground-explorer"
        >
          <Waypoints size={14} /> View Underground Infrastructure
        </a>
        <button className="btn-ghost justify-center" onClick={() => navigator.clipboard?.writeText(selection.propertyId)}>
          <Share2 size={14} /> Share ID
        </button>
        <button className="btn-ghost justify-center" onClick={() => setNote(note ? '' : ' ')}>
          <StickyNote size={14} /> Add Note
        </button>
        {cert && (
          <button
            className="btn-primary col-span-2 justify-center"
            onClick={() => setShowCert(true)}
            data-testid="open-certificate"
          >
            <FileText size={14} /> Download Certificate
          </button>
        )}
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
    {showCert && cert && (
      <Suspense fallback={<CertificateModalFallback />}>
        <PropertyCertificateModal data={cert} onClose={() => setShowCert(false)} />
      </Suspense>
    )}
    <GenerateThreeDUlpinDialog
      open={showGen3D}
      onClose={() => setShowGen3D(false)}
      onConfirm={generate3D}
      busy={gen3DBusy}
      building={h?.building?.name}
      floor={h?.floor?.label}
      unit={h?.unit?.id}
    />
    </>
  )
}

// --------------------------------------------------------------------------
// Building / floor selection card — the authoritative building record (id,
// ULPIN, locality, floor & unit counts, height, prototype volume) plus the
// Phase 5 elevation panel. Replaces the old bare placeholder so a building
// picked in the 3D scene, the Buildings table or a deep link always shows
// what was actually selected.
// --------------------------------------------------------------------------
// Lazy floor → apartment list (spec section 14). Uses ACTUAL floor/unit records;
// shows "Apartment data unavailable." when a floor has none.
function FloorApartments({ floor }) {
  const [open, setOpen] = useState(false)
  const q = useApi(
    () => (open && floor?.floorId ? api.floor(floor.floorId).catch(() => null) : Promise.resolve(null)),
    [open, floor?.floorId],
  )
  const units = Array.isArray(q.data?.units) ? q.data.units : []
  return (
    <li className="rounded border border-slate-200">
      <button
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[11px] font-semibold text-slate-700"
        onClick={() => setOpen((v) => !v)}
        data-testid={`building-floor-${floor.floorSegment || floor.floorNumber}`}
      >
        <span>{floor.label || `Floor ${floor.floorNumber}`}</span>
        <span className="text-slate-400">{(floor.unitCount ?? units.length ?? 0)}u {open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-2 py-1">
          {q.loading && <Spinner label="…" />}
          {!q.loading && units.length === 0 && <p className="text-[11px] text-slate-500">Apartment data unavailable.</p>}
          {units.length > 0 && (
            <ul className="grid grid-cols-3 gap-1">
              {units.map((u) => (
                <li key={u.propertyId}>
                  <span className="block rounded bg-slate-100 px-1 py-0.5 text-center font-mono text-[10px] text-slate-700" data-testid={`building-unit-${u.unitId}`}>
                    {u.unitId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function BuildingCard({ query, elevQuery, mode, buildingId, mapApi, onClose, onSelectParcel, generatedBy, can3dUlpin }) {
  const { data, error, loading, reload } = query
  const b = data?.building
  const floors = Array.isArray(data?.floors) ? data.floors : []
  const topo = data?.topology
  const vm = b?.volume ? volumeMetrics(b.volume) : null
  const stone = b?.constructionStatus === 'Completed' ? 'Verified'
    : b?.constructionStatus === 'Stalled' ? 'Disputed' : 'Under Review'
  const locId = b ? (LOCALITIES_FALLBACK.find((l) => l.ulpinPrimary === b.ulpin)?.id || b.locality) : null
  const heightLabel = {
    LIDAR_DERIVED: 'LIDAR-DERIVED', DEMO_PROCEDURAL: 'DEMO / PROCEDURAL',
    SURVEY: 'SURVEY', OFFICIAL: 'SOURCE-VERIFIED', UNAVAILABLE: 'UNAVAILABLE',
  }[b?.heightSource] || (b?.heightSource || 'DEMO / PROCEDURAL')
  const [showCert, setShowCert] = useState(false)
  const [showGen3D, setShowGen3D] = useState(false)
  const [gen3DBusy, setGen3DBusy] = useState(false)
  const cert = b ? buildBuildingCertificate({ buildingData: data, generatedBy }) : null

  const generate3D = async () => {
    setGen3DBusy(true)
    try {
      await api.generateBuildingThreeDUlpin(buildingId).catch(() => {})
      await reload()
    } finally {
      setGen3DBusy(false)
      setShowGen3D(false)
    }
  }

  return (
    <>
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">{mode === 'floor' ? 'Floor — Building' : 'Building'}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-warn">
            <DemoTag label="PROTOTYPE" /> Synthetic demo building — not an official record
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="building-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {b && (
          <>
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5">
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all" data-testid="building-id">{b.buildingId}</p>
              <p className="mt-0.5 text-[12px] font-semibold text-slate-700">{b.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge status={stone}>{b.constructionStatus || 'Unknown'}</Badge>
                {b.constructionType && <Badge>{b.constructionType}</Badge>}
                {b.approvalStatus && <Badge>{b.approvalStatus}</Badge>}
              </div>
            </div>

            <Section title="Building">
              <KeyValue
                data={{
                  'Building ID': b.buildingId,
                  'Official ULPIN': b.officialUlpin ? formatUlpinDisplay(b.officialUlpin) : 'Unavailable',
                  Locality: b.locality || 'Unavailable',
                  Floors: b.totalFloors ?? b.floorsAboveGround ?? floors.length ?? 'Unavailable',
                  Units: b.unitCount ?? data?.unitCount ?? 'Unavailable',
                  Height: b.heightM != null ? `${b.heightM} m` : (vm?.heightM != null ? `${vm.heightM} m` : 'Unavailable'),
                  Footprint: b.footprintSqm != null ? `${b.footprintSqm} m²` : (vm?.footprintM2 != null ? `${vm.footprintM2} m²` : 'Unavailable'),
                  'Est. volume': vm?.volumeM3 != null ? `${vm.volumeM3} m³` : 'Unavailable',
                  'Completion year': b.completionYear || 'Unavailable',
                }}
              />
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-600">
                <Layers size={12} className="text-primary" /> ULPIN (Parcel):{' '}
                {b.ulpin ? (
                  <button className="data-mono text-slate-900 underline decoration-dotted" onClick={() => onSelectParcel(b.ulpin)}>
                    {formatUlpinDisplay(b.ulpin)}
                  </button>
                ) : (
                  <span className="text-slate-500">Unavailable</span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-600" data-testid="building-3d-ulpin">
                <Fingerprint size={12} className="text-primary" /> 3D ULPIN:{' '}
                {b.threeDUlpin ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="data-mono text-slate-900" title="System Generated 3D Property Identifier">{b.threeDUlpin}</span>
                    <button
                      className="text-slate-400 hover:text-slate-700"
                      onClick={() => navigator.clipboard?.writeText(b.threeDUlpin)}
                      aria-label="Copy 3D ULPIN"
                      title="Copy 3D ULPIN"
                      type="button"
                    >
                      <Copy size={11} />
                    </button>
                  </span>
                ) : (
                  <span className="text-slate-500">Not generated</span>
                )}
              </div>
            </Section>

            <Section title="Geometry & Provenance">
              <KeyValue
                data={{
                  'Height source': heightLabel,
                  'Height provenance': b.heightProvenance || 'DEMO',
                  'Height verification': b.heightVerification || 'UNVERIFIED',
                  Source: b.isDemo === false ? (b.heightProvenance || 'SOURCE') : 'DEMO / PROTOTYPE',
                  'Geometry status': topo?.status || 'NOT_RUN',
                  'Volume ID': b.volume?.volumeId || 'Unavailable',
                  'Geometry status (volume)': b.volume?.geometryStatus || 'Unavailable',
                }}
              />
              {(topo?.findings || []).length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px]" data-testid="building-topology-findings">
                  {topo.findings.map((f) => (
                    <li key={f.validationId || f.ruleId}>
                      <span className={f.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{f.status}</span>{' '}
                      <span className="font-mono text-slate-500">{f.ruleId}</span> — {f.message}
                    </li>
                  ))}
                </ul>
              )}
              {b.isDemo !== false && (
                <p className="mt-1 text-[10px] text-warn">
                  Synthetic prototype geometry — the height is DEMO / PROCEDURAL, not a surveyed value.
                </p>
              )}
            </Section>

            <Section title="Apartments">
              {floors.length === 0 ? (
                <p className="text-[11px] text-slate-500">Apartment data unavailable.</p>
              ) : (
                <ul className="space-y-1" data-testid="building-apartments">
                  {[...floors].sort((a, c) => (a.floorNumber ?? 0) - (c.floorNumber ?? 0)).map((f) => (
                    <FloorApartments key={f.floorId} floor={f} />
                  ))}
                </ul>
              )}
            </Section>

            <div className="mt-2 grid grid-cols-1 gap-1.5">
              <button
                className="btn-ghost justify-center"
                data-testid="building-focus"
                onClick={() => mapApi.current?.flyToBuilding?.(buildingId)}
              >
                <Focus size={13} /> Focus
              </button>
              <a
                href={explorerUrl({ ulpin: b.ulpin, buildingSeg: b.buildingSegment })}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost justify-center"
                data-testid="building-open-explorer"
              >
                <Box size={14} /> Open 3D Building Explorer
              </a>
              <a
                href={undergroundUrl({ area: locId, ulpin: b.ulpin })}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost justify-center"
                data-testid="building-open-underground"
              >
                <Waypoints size={14} /> View Underground Infrastructure
              </a>
              {can3dUlpin && (
                b.threeDUlpin ? (
                  <p className="flex items-center justify-center gap-1.5 rounded-md border border-teal/30 bg-teal/10 px-2 py-1.5 text-xs font-semibold text-teal">
                    <Fingerprint size={13} /> Already Generated
                  </p>
                ) : (
                  <button
                    className="btn-ghost justify-center"
                    onClick={() => setShowGen3D(true)}
                    data-testid="generate-3d-ulpin"
                  >
                    <Fingerprint size={14} /> Generate 3D ULPIN
                  </button>
                )
              )}
              {cert && (
                <button
                  className="btn-primary justify-center"
                  onClick={() => setShowCert(true)}
                  data-testid="open-certificate"
                >
                  <FileText size={14} /> Download Certificate
                </button>
              )}
            </div>

            <BuildingElevationPanel query={elevQuery} />

            <p className="mt-3 text-[11px] text-slate-500">
              {mode === 'floor'
                ? 'Floor selected. Choose a unit from the floor plan or the 3D scene.'
                : 'Pick a floor above to see its apartments, or open the detailed 3D Building Explorer.'}
            </p>
          </>
        )}
      </div>
    </aside>
    {showCert && cert && (
      <Suspense fallback={<CertificateModalFallback />}>
        <PropertyCertificateModal data={cert} onClose={() => setShowCert(false)} />
      </Suspense>
    )}
    <GenerateThreeDUlpinDialog
      open={showGen3D}
      onClose={() => setShowGen3D(false)}
      onConfirm={generate3D}
      busy={gen3DBusy}
      building={b?.name || buildingId}
    />
    </>
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
      <div className="mt-3 rounded-lg border border-slate-200 p-2.5" data-testid="elevation-unavailable">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          <Mountain size={12} /> Building Height
        </p>
        <p className="mt-1 text-[12px] text-slate-600">Unavailable</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Reason: {h.reason}</p>
      </div>
    )
  }

  const qtone = h.qualityStatus === 'VALID' ? 'Verified' : h.qualityStatus === 'ERROR' ? 'Disputed' : 'Under Review'
  return (
    <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 p-2.5" data-testid="elevation-height-panel">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-warn">
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
        {h.appliedToBuilding && <span className="text-[10px] text-teal">Applied to 3D extrusion</span>}
      </div>
      {(h.qualityIssues || []).length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
          {h.qualityIssues.slice(0, 3).map((i, idx) => (
            <li key={idx}><span className={i.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{i.status}</span> {i.message}</li>
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
function ParcelCard({ query, ulpin, mapApi, onClose, canVerify, generatedBy }) {
  const { data, error, loading, reload } = query
  const p = data?.parcel
  const prov = data?.provenance || {}
  const badge = verificationBadge(prov.verificationStatus)
  const official = isOfficial(prov.verificationStatus)
  const coord = p?.centroid?.coordinates
  const gov = data?.providerChain?.find((c) => c.provider === 'GovernmentDataProvider')
  const [showCert, setShowCert] = useState(false)
  const cert = p ? buildParcelCertificate({ parcelData: data, generatedBy }) : null

  const verify = async () => {
    await api.verifyParcel(ulpin).catch(() => {})
    reload()
  }

  return (
    <>
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">Land Parcel Record</p>
          <p
            className={clsx(
              'mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold',
              official ? 'text-brass' : 'text-warn',
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
                official ? 'border-brass/30 bg-brass/10' : 'border-warn/30 bg-warn/10',
              )}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {official ? 'ULPIN (Official — Government Source)' : 'Parcel ID (Demo — Not an Official ULPIN)'}
              </p>
              <p className="mt-0.5 data-mono text-[13px] font-bold text-slate-900 break-all" data-testid="parcel-ulpin">
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
                <p className="mt-1 text-[10px] text-warn">{prov.disclaimer}</p>
              )}
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-slate-200 p-3">
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
        <a
          href={undergroundUrl({ area: p?.locality, ulpin })}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost col-span-2 justify-center"
          data-testid="open-underground-explorer"
        >
          <Waypoints size={14} /> View Underground Infrastructure
        </a>
        {cert && (
          <button
            className="btn-primary col-span-2 justify-center"
            onClick={() => setShowCert(true)}
            data-testid="open-certificate"
          >
            <FileText size={14} /> Download Certificate
          </button>
        )}
      </footer>
    </aside>
    {showCert && cert && (
      <Suspense fallback={<CertificateModalFallback />}>
        <PropertyCertificateModal data={cert} onClose={() => setShowCert(false)} />
      </Suspense>
    )}
    </>
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
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">AI-Extracted Building</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-warn" data-testid="ai-building-source">
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
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-2.5">
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all">{b.aiBuildingId}</p>
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
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                  {b.geometryIssues.map((m, i) => (
                    <li key={i}><span className="text-warn">•</span> {m}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-warn">Height shown in 3D is an ESTIMATED / DEMO value — not survey / LiDAR / GNSS-derived.</p>
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
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600" data-testid="ai-parcel-candidates">
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
                {b.reviewRequired && <span className="text-[11px] text-warn">Requires Review</span>}
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
              <p className="mt-1.5 text-[10px] text-warn">
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
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">AI Floor-Plan Unit</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-warn" data-testid="ai-floor-unit-source">
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
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-2.5">
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all">{u.localUnitId || u.aiFloorUnitId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <DemoTag label="AI / PROTOTYPE" />
                <Badge>{level}</Badge>
                <Badge status={gtone}>{u.geometryStatus}</Badge>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
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
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                  {u.roomDetails.map((r) => (
                    <li key={r.roomId}>
                      <span className="font-mono text-slate-500">{r.localRoomId}</span> · {r.roomType || r.class}
                      {r.reviewRequired && <span className="text-warn"> · review</span>}
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
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                  {u.ambiguityReasons.map((m, i) => (
                    <li key={i}><span className="text-warn">•</span> {m}</li>
                  ))}
                </ul>
              )}
            </Section>

            {vol && (
              <Section title="3D Volume (Prototype, Phase 2 model)">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-warn">
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
                      <p key={i} className="mt-1 text-[11px] text-slate-600">
                        <span className={it.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{it.status}</span>{' '}
                        <span className="font-mono text-slate-500">{it.rule}</span> — {it.message}
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
                {u.reviewRequired && <span className="text-[11px] text-warn">Requires Review</span>}
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
              <p className="mt-1.5 text-[10px] text-warn">
                AI-inferred apartment boundary. Human review is required for any authoritative use; it creates no ownership,
                rights or official cadastral record, and never an official ULPIN.
              </p>
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-2 gap-1.5 border-t border-slate-200 p-3">
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
// Coimbatore — the ONE demonstration property. Backed by a real `buildings`
// document (buildingId COIMBATORE-DEMO-001, see backend/src/data/seed.js)
// carrying a real, user-supplied official ULPIN and land-record fields —
// unlike every other Chennai building in this prototype. The 3D
// reconstruction itself (geometry/volume/height, the DMS/plus-code/model
// fields below) remains client-only display metadata about the ODM capture,
// never presented as a surveyed cadastral volume.
function CoimbatoreDemoCard({ query, onClose, generatedBy, can3dUlpin }) {
  const p = COIMBATORE_DEMO_PROPERTY
  const { data, error, loading, reload } = query
  const b = data?.building
  const [showCert, setShowCert] = useState(false)
  const [showGen3D, setShowGen3D] = useState(false)
  const [gen3DBusy, setGen3DBusy] = useState(false)
  const cert = b ? buildBuildingCertificate({ buildingData: data, generatedBy }) : null

  const generate3D = async () => {
    setGen3DBusy(true)
    try {
      await api.generateBuildingThreeDUlpin(p.propertyId).catch(() => {})
      await reload()
    } finally {
      setGen3DBusy(false)
      setShowGen3D(false)
    }
  }

  return (
    <>
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">{p.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-warn" data-testid="coimbatore-demo-source">
            <DemoTag label={p.verification} /> user-provided ODM reconstruction — not a surveyed 3D volume
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="coimbatore-demo-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />

        <div className="rounded-lg border border-brass/30 bg-brass/10 p-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-brass">Official ULPIN</p>
          <p className="data-mono mt-0.5 text-[13px] font-bold text-slate-900 break-all">{p.ulpin}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusPillInline>{p.status}</StatusPillInline>
          </div>
        </div>

        <Section title="Land Record">
          <KeyValue
            data={{
              District: `${p.district} / ${p.districtTamil}`,
              Taluk: `${p.taluk} / ${p.talukTamil}`,
              Village: `${p.village} / ${p.villageTamil}`,
              'Village LGD Code': p.villageLgdCode,
              'Survey Number': p.surveyNumber,
              'Sub Division': p.subdivisionNumber,
              Centroid: `${p.officialCentroid.lat}, ${p.officialCentroid.lon}`,
            }}
          />
        </Section>

        <Section title="3D ULPIN">
          <div className="flex items-center gap-2 text-[12px] text-slate-600" data-testid="coimbatore-3d-ulpin">
            <Fingerprint size={12} className="text-primary" /> 3D ULPIN:{' '}
            {b?.threeDUlpin ? (
              <span className="inline-flex items-center gap-1">
                <span className="data-mono text-slate-900" title="System Generated 3D Property Identifier">{b.threeDUlpin}</span>
                <button
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() => navigator.clipboard?.writeText(b.threeDUlpin)}
                  aria-label="Copy 3D ULPIN"
                  title="Copy 3D ULPIN"
                  type="button"
                >
                  <Copy size={11} />
                </button>
              </span>
            ) : (
              <span className="text-slate-500">Not generated</span>
            )}
          </div>
          {can3dUlpin && b && (
            b.threeDUlpin ? (
              <p className="mt-1.5 flex items-center justify-center gap-1.5 rounded-md border border-teal/30 bg-teal/10 px-2 py-1.5 text-xs font-semibold text-teal">
                <Fingerprint size={13} /> Already Generated
              </p>
            ) : (
              <button
                className="btn-ghost mt-1.5 w-full justify-center"
                onClick={() => setShowGen3D(true)}
                data-testid="coimbatore-generate-3d-ulpin"
              >
                <Fingerprint size={14} /> Generate 3D ULPIN
              </button>
            )
          )}
        </Section>

        <Section title="Coordinates">
          <KeyValue
            data={{
              Latitude: p.lat,
              Longitude: p.lon,
              DMS: p.dms,
              'Plus Code': p.plusCode,
            }}
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Model coordinates locate the 3D reconstruction; the official centroid in Land Record above is the
            government-sourced parcel centroid.
          </p>
        </Section>

        <Section title="3D Source">
          <KeyValue
            data={{
              '3D Source': p.threeDSource,
              'Model Type': p.modelType,
              Verification: p.verification,
              Status: p.status,
            }}
          />
        </Section>

        <div className="mt-2 grid grid-cols-1 gap-1.5">
          <a
            href={COIMBATORE_EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-primary justify-center"
            data-testid="coimbatore-open-explorer"
          >
            <Box size={14} /> Open 3D Property Explorer
          </a>
          {cert && (
            <button
              className="btn-ghost justify-center"
              onClick={() => setShowCert(true)}
              data-testid="open-certificate"
            >
              <FileText size={14} /> Download Certificate
            </button>
          )}
        </div>
      </div>
    </aside>
    {showCert && cert && (
      <Suspense fallback={<CertificateModalFallback />}>
        <PropertyCertificateModal data={cert} onClose={() => setShowCert(false)} />
      </Suspense>
    )}
    <GenerateThreeDUlpinDialog
      open={showGen3D}
      onClose={() => setShowGen3D(false)}
      onConfirm={generate3D}
      busy={gen3DBusy}
      building={p.propertyId}
    />
    </>
  )
}

function StatusPillInline({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-700">
      {children}
    </span>
  )
}

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
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">GNSS/CORS Control Point</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-warn" data-testid="gnss-point-source">
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
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-2.5">
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all">{p.controlPointId}</p>
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
              <p className="mt-1.5 text-[10px] text-warn">
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
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                  {p.validationIssues.map((i, idx) => (
                    <li key={idx}>
                      <span className={i.status === 'ERROR' ? 'text-danger' : 'text-warn'}>{i.status}</span>{' '}
                      <span className="font-mono text-slate-500">{i.rule}</span> — {i.message}
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
                  <p className="mt-1.5 text-[10px] text-warn">
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
              <p className="mt-1.5 text-[10px] text-warn">
                GNSS/CORS DEMO / MODEL OUTPUT — not automatically an official cadastral control point. Existing parcel
                geometry is never overwritten without explicit authorized review.
              </p>
            </Section>
          </>
        )}
      </div>

      <footer className="grid grid-cols-1 gap-1.5 border-t border-slate-200 p-3">
        <button className="btn-ghost justify-center" onClick={() => mapApi.current.flyToGnssPoint?.(id)}>
          <Satellite size={14} /> Zoom To
        </button>
      </footer>
    </aside>
  )
}

// --------------------------------------------------------------------------
// Underground infrastructure (Phase 8). Data is shown ONLY from available
// official / authorized / uploaded / research / demonstration datasets.
// Spatial intersection does NOT establish legal ownership. Depth/elevation is
// only shown when the source supplied it; DEMO depth is labelled DEMO DEPTH and
// unknown depth is labelled DEPTH UNKNOWN — never a fabricated value.
// --------------------------------------------------------------------------
function DepthDiagram({ p }) {
  const surf = Number.isFinite(p.surfaceElevationM) ? p.surfaceElevationM : null
  const top = Number.isFinite(p.topElevationM) ? p.topElevationM : null
  const bot = Number.isFinite(p.bottomElevationM) ? p.bottomElevationM : null
  const depth = Number.isFinite(p.depthBelowSurfaceM) ? p.depthBelowSurfaceM : null
  const demo = p.verificationStatus === 'DEMO' || p.source === 'DEMO'
  if (top == null && depth == null) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px]" data-testid="infra-depth-unknown">
        <p className="font-bold text-slate-500">DEPTH UNKNOWN</p>
        <p className="mt-0.5 text-slate-500">This dataset did not supply a reliable depth or elevation. No value is shown or drawn as real.</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-600" data-testid="infra-depth-diagram">
      <div className="flex items-center justify-between"><span>Surface</span><span>{surf != null ? `${surf} m` : '—'}</span></div>
      <div className="my-1 border-t border-dashed border-slate-600" />
      <div className="flex items-center justify-between text-slate-900">
        <span>{String(p.type || '').replace(/_/g, ' ')}</span>
        <span>{depth != null ? `−${depth} m` : (top != null && surf != null ? `−${(surf - top).toFixed(2)} m` : '—')}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-slate-500">
        <span>crown / invert</span>
        <span>{top != null ? `${top}` : '—'} / {bot != null ? `${bot}` : '—'} m</span>
      </div>
      <p className="mt-1 text-[10px] text-warn">
        {demo
          ? 'DEMO DEPTH — illustrative, relative to local ground surface; vertical datum UNKNOWN.'
          : `Reference: ${p.depthReference || 'UNKNOWN'} · Vertical datum: ${p.verticalDatum || 'UNKNOWN'}`}
      </p>
    </div>
  )
}

function InfrastructureCard({ query, relQuery, elevQuery, id, onClose, mapApi, canReview }) {
  const { data: p, error, loading, reload } = query
  const { data: rel } = relQuery || {}
  const { data: elev } = elevQuery || {}
  const [busy, setBusy] = useState(false)

  const official = Boolean(p?.isOfficial)
  const stone = p?.status === 'OPERATIONAL' ? 'Verified' : p?.status === 'ABANDONED' ? 'Disputed' : 'Under Review'

  const review = async (action) => {
    setBusy(true)
    await api.infrastructureReview(id, action).catch(() => {})
    setBusy(false)
    reload()
  }

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">Underground Infrastructure</p>
          <p
            className={clsx('mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold', official ? 'text-brass' : 'text-warn')}
            data-testid="infra-source"
          >
            {official ? <BadgeCheck size={12} /> : <TriangleAlert size={12} />}
            {official ? `${p.source} — authoritative dataset` : `${p?.source || 'UNVERIFIED'} — not authoritative Chennai infrastructure`}
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="infra-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {p && (
          <>
            <div className={clsx('rounded-lg border p-2.5', official ? 'border-brass/30 bg-brass/10' : 'border-warn/30 bg-warn/10')}>
              <p className="data-mono text-[13px] font-bold text-slate-900 break-all" data-testid="infra-id">{p.infrastructureId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!official && <DemoTag label={p.verificationStatus || 'DEMO'} />}
                <Badge>{p.type}</Badge>
                <Badge status={stone}>{p.status}</Badge>
              </div>
            </div>

            <Section title="Infrastructure">
              <KeyValue
                data={{
                  Type: p.type,
                  Subtype: p.subtype || '—',
                  'Owner / Authority': p.ownerAuthority || 'Not provided',
                  Status: p.status,
                  Diameter: p.diameterM != null ? `${p.diameterM} m` : undefined,
                  Width: p.widthM != null ? `${p.widthM} m` : undefined,
                  Height: p.heightM != null ? `${p.heightM} m` : undefined,
                  Source: p.source,
                  Verification: p.verificationStatus,
                  Timestamp: p.timestamp ? String(p.timestamp).slice(0, 19).replace('T', ' ') : 'Not available',
                }}
              />
            </Section>

            <Section title="Depth & Elevation">
              <DepthDiagram p={p} />
              <div className="mt-2">
                <KeyValue
                  data={{
                    'Surface Elevation': p.surfaceElevationM != null ? `${p.surfaceElevationM} m` : 'Not available',
                    'Top Elevation': p.topElevationM != null ? `${p.topElevationM} m` : 'Not available',
                    'Bottom Elevation': p.bottomElevationM != null ? `${p.bottomElevationM} m` : 'Not available',
                    'Depth Below Surface': p.depthBelowSurfaceM != null ? `${p.depthBelowSurfaceM} m` : 'Not available',
                    'Depth Reference': p.depthReference || 'UNKNOWN',
                    'Vertical Datum': p.verticalDatum || 'UNKNOWN',
                    'Vertical Status': p.verticalStatus || 'UNKNOWN',
                  }}
                />
              </div>
              {elev?.dataAvailability === 'AVAILABLE' && (
                <p className="mt-1.5 text-[10px] text-slate-500">
                  Phase 5 context: nearest building {elev.nearestBuildingId} at {elev.nearestBuildingDistanceM} m ·
                  surface ≈ {elev.surfaceElevationM} m ({elev.surfaceElevationSource}). {elev.note}
                </p>
              )}
            </Section>

            <Section title="CRS">
              <KeyValue
                data={{
                  'Input CRS': p.inputCRS || 'Unknown',
                  'Output CRS': p.outputCRS || 'EPSG:4326',
                  'CRS Status': p.crsStatus || 'UNKNOWN',
                  'Horizontal Datum': p.horizontalDatum || '—',
                }}
              />
            </Section>

            {(p.controlPointId || p.surveySessionId || p.reportedAccuracyM != null || p.surveyMethod) && (
              <Section title="Survey Linkage (Phase 6)">
                <KeyValue
                  data={{
                    'Control Point': p.controlPointId || '—',
                    'Survey Session': p.surveySessionId || '—',
                    'Reference Station': p.referenceStation || '—',
                    'Survey Method': p.surveyMethod || '—',
                    'Reported Accuracy': p.reportedAccuracyM != null ? `${p.reportedAccuracyM} m` : 'Not claimed',
                  }}
                />
              </Section>
            )}

            <Section title="Property Relationship">
              <p className="mb-1.5 text-[10px] text-warn">
                Spatial and legal relationships are shown separately. A spatial intersection does <strong>not</strong> establish legal ownership.
              </p>
              <KeyValue
                data={{
                  'Related Parcel': p.parentParcelULPIN || p.parentParcel || '—',
                  'Spatial Relation': p.spatialRelation || '—',
                  'Related Building': p.parentBuilding || '—',
                  'Legal Ownership': p.legalOwnership || 'NOT_PROVIDED',
                }}
              />
              {(rel?.parcelRelations || []).length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600" data-testid="infra-parcel-relations">
                  {rel.parcelRelations.slice(0, 4).map((r) => (
                    <li key={r.parcelId}>
                      <span className="font-mono text-slate-500">{r.ulpin || r.parcelId}</span> · {r.spatialRelation}
                      <span className="text-slate-500"> · {r.nearestBoundaryM} m</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-slate-500">{rel?.ownershipNote || 'Legal ownership is only shown when authoritative data supplies it.'}</p>
            </Section>

            <Section title="Provenance & Confidence" defaultOpen={false}>
              <KeyValue
                data={{
                  Source: p.source,
                  'Verification Status': p.verificationStatus,
                  'Is Official': official ? 'Yes' : 'No',
                  Confidence: p.confidence != null ? `${Math.round(p.confidence * 100)}%` : 'Not provided',
                  'Review Action': p.reviewAction || '—',
                  Note: p.provenanceNote || '—',
                }}
              />
            </Section>

            {canReview && (
              <Section title="Review">
                <div className="grid grid-cols-3 gap-1.5">
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => review('ACKNOWLEDGED')}>Acknowledge</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => review('ACCEPTED')}>Accept</button>
                  <button className="btn-ghost !py-1 justify-center text-[11px]" disabled={busy} onClick={() => review('NEEDS_CORRECTION')}>Correct</button>
                </div>
                <p className="mt-1.5 text-[10px] text-warn">
                  A review records that a reviewer looked at this record. It never promotes the source to official and never changes geometry or depth.
                </p>
              </Section>
            )}

            <p className="mt-2 text-[10px] text-warn" data-testid="infra-disclaimer">
              UNDERGROUND INFRASTRUCTURE DATA. Geometry, depth, elevation, ownership/authority and status are shown only from available
              official, authorized, uploaded, research or demonstration datasets. Spatial intersection does not establish legal ownership.
              Underground depth/elevation is only reported when supported by source data. Demonstration data is clearly labelled DEMO and
              is not authoritative Chennai utility infrastructure.
            </p>
          </>
        )}
      </div>

      <footer className="grid grid-cols-1 gap-1.5 border-t border-slate-200 p-3">
        <button className="btn-ghost justify-center" data-testid="infra-focus" onClick={() => mapApi.current.flyToInfrastructure?.(id)}>
          <Waypoints size={14} /> Focus
        </button>
        <a
          href={undergroundUrl({ area: p?.locality, ulpin: p?.parentParcelULPIN || p?.parentParcel, infrastructureId: id })}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost justify-center"
          data-testid="open-underground-explorer"
        >
          <Box size={14} /> Open 3D Underground Explorer
        </a>
      </footer>
    </aside>
  )
}

// --------------------------------------------------------------------------
// TNGIS / Tamil Nilam — a PUBLIC-source (OFFICIAL_SOURCE) parcel. Geometry +
// administrative hierarchy + LGD codes come verbatim from the public Tamil
// Nadu GIS endpoints. The official ULPIN / Patta / EC / Property Tax / ownership
// are served ONLY by the authenticated, encrypted TNGIS API and are NOT
// integrated — they are shown as "Unavailable from current public source",
// never fabricated. A spatial building overlap is not an ownership claim.
// --------------------------------------------------------------------------
function TngisParcelCard({ query, relQuery, id, onClose, mapApi, canValidate }) {
  const { data: p, error, loading, reload } = query
  const { data: rel } = relQuery || {}
  const [topo, setTopo] = useState(null)
  const [topoBusy, setTopoBusy] = useState(false)

  const runTopology = async () => {
    setTopoBusy(true)
    try { setTopo(await api.tngisValidateTopology(id)) } catch (e) { setTopo({ error: String(e.message || e) }) }
    setTopoBusy(false)
  }

  const buildingRel = (rel?.buildingRelations || [])[0] || null
  const polyCount = p?.geometry?.type === 'MultiPolygon'
    ? p.geometry.coordinates.length
    : p?.geometry?.type === 'Polygon' ? 1 : 0

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col panel"
      data-testid="property-sidebar"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-slate-900">TNGIS / Tamil Nilam Parcel</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-brass" data-testid="tngis-source">
            <BadgeCheck size={12} /> {p?.source || 'TNGIS_TAMIL_NILAM'} · OFFICIAL SOURCE · SOURCE-VERIFIED GEOMETRY
          </p>
        </div>
        <button className="btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="tngis-card">
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {p && (
          <>
            <div className="rounded-lg border border-brass/30 bg-brass/10 p-2.5">
              <p className="data-mono text-[12px] font-bold text-slate-900 break-all" data-testid="tngis-record-id">{p.sourceRecordId}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge status="Verified">{p.verificationStatus}</Badge>
                <Badge>{p.geometryType || 'no geometry'}</Badge>
              </div>
            </div>

            <Section title="Administrative">
              <KeyValue
                data={{
                  District: `${p.districtName || '—'} (${p.districtCode})`,
                  Taluk: `${p.talukName || '—'} (${p.talukCode})`,
                  Village: `${p.villageName || '—'} (${p.villageCode})`,
                  'District LGD': p.lgdDistrictCode || '—',
                  'Taluk LGD': p.lgdTalukCode || '—',
                  'Village LGD': p.lgdVillageCode || '—',
                  'Survey Number': p.surveyNumber || '—',
                  'Sub Division': p.subDivision || 'Unavailable from public TNGIS source',
                }}
              />
            </Section>

            <Section title="Geometry">
              <KeyValue
                data={{
                  'Geometry source': `TNGIS public source · ${polyCount} polygon(s)`,
                  Type: p.geometryType || 'Unavailable',
                  CRS: p.sourceCRS || 'EPSG:4326',
                  Centroid: p.centroid
                    ? `${p.centroid.latitude.toFixed(6)}, ${p.centroid.longitude.toFixed(6)}`
                    : 'Unavailable',
                  'Source record ID': p.sourceRecordId,
                  'Source updated': p.sourceUpdatedAt ? String(p.sourceUpdatedAt).slice(0, 10) : 'Unavailable',
                  Retrieved: p.retrievedAt ? String(p.retrievedAt).slice(0, 19).replace('T', ' ') : '—',
                }}
              />
            </Section>

            <Section title="Provenance">
              <KeyValue
                data={{
                  Source: p.source,
                  'Source Type': p.sourceType,
                  Provenance: p.provenance,
                  'Verification Status': p.verificationStatus,
                  'Source Geometry': p.sourceGeometry ? 'Yes' : 'No',
                }}
              />
              <div className="mt-2 rounded border border-warn/30 bg-warn/10 p-2 text-[11px]" data-testid="tngis-ulpin">
                <p className="font-bold text-warn">Official ULPIN</p>
                <p className="text-warn">Unavailable from current public source
                  ({p.officialULPINStatus || 'UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE'}).
                  The public TNGIS endpoints do not expose ULPIN as structured data; it is not fabricated here.
                  Prototype / DEMO ULPIN records are kept entirely separate.</p>
              </div>
            </Section>

            <Section title="Building Relationship">
              <p className="mb-1.5 text-[10px] text-warn">
                A building footprint overlapping this parcel is a <strong>spatial fact only</strong> — not an ownership claim.
              </p>
              {(rel?.buildingRelations || []).length > 0 ? (
                <ul className="space-y-0.5 text-[11px] text-slate-600" data-testid="tngis-building-relations">
                  {rel.buildingRelations.slice(0, 6).map((r) => (
                    <li key={r.buildingId} className="flex items-center gap-1.5">
                      <Building2 size={11} className="text-primary" />
                      <span className="font-mono">{r.buildingId}</span>
                      <span className="text-slate-400">· {r.relationship} · {r.nearestBoundaryM} m</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">No existing building geometry overlaps this parcel.</p>
              )}
              <p className="mt-1 text-[10px] text-slate-500">{rel?.ownershipNote || 'Ownership is only shown from authoritative legal records.'}</p>
            </Section>

            <Section title="Topology (Phase 7)" defaultOpen={false}>
              {canValidate ? (
                <button className="btn-ghost !py-1 justify-center text-[11px]" data-testid="tngis-run-topology" disabled={topoBusy} onClick={runTopology}>
                  {topoBusy ? <Spinner label="Validating…" /> : 'Validate geometry topology'}
                </button>
              ) : (
                <p className="text-[11px] text-slate-500">Requires the <code>topology:validate</code> permission.</p>
              )}
              {topo?.error && <p className="mt-1 text-[11px] text-danger">{topo.error}</p>}
              {topo?.summary && (
                <div className="mt-1.5" data-testid="tngis-topology-results">
                  <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                    <div><b>{topo.summary.valid ?? 0}</b><br />valid</div>
                    <div><b>{topo.summary.warning ?? 0}</b><br />warn</div>
                    <div><b>{topo.summary.error ?? 0}</b><br />error</div>
                    <div><b>{topo.summary.reviewRequired ?? 0}</b><br />review</div>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                    {(topo.findings || []).slice(0, 10).map((f, i) => (
                      <li key={i}>
                        <span className={f.status === 'ERROR' ? 'text-danger' : f.status === 'VALID' ? 'text-teal' : 'text-warn'}>{f.status}</span>{' '}
                        <span className="font-mono text-slate-500">{f.ruleId || f.rule}</span> — {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <p className="mt-2 text-[10px] text-warn" data-testid="tngis-disclaimer">
              {p.disclaimer}
            </p>
          </>
        )}
      </div>

      <footer className="grid grid-cols-1 gap-1.5 border-t border-slate-200 p-3">
        <button className="btn-ghost justify-center" data-testid="tngis-focus" onClick={() => mapApi.current.flyToTngisParcel?.(id)}>
          <Waypoints size={14} /> Focus
        </button>
        {buildingRel && (
          <a
            href={explorerUrl({ ulpin: buildingRel.ulpin || undefined, buildingSeg: buildingRel.buildingId })}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost justify-center"
            data-testid="tngis-open-building-explorer"
          >
            <Box size={14} /> Open 3D Building Explorer ({buildingRel.buildingId})
          </a>
        )}
      </footer>
    </aside>
  )
}
