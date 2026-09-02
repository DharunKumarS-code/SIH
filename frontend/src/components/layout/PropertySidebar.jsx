import { useState } from 'react'
import clsx from 'clsx'
import {
  X, Crosshair, Focus, ShieldCheck, FileText, Share2, StickyNote, Building2, Layers, Home,
} from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApi } from '../../lib/useApi.js'
import { api } from '../../lib/api.js'
import { Badge, DemoTag, KeyValue, Spinner, ErrorNote } from '../ui/primitives.jsx'
import { inr } from '../../lib/format.js'
import { PROTOTYPE_ID_LABEL } from '../../lib/constants.js'

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
  const { data, error, loading, reload } = useApi(
    () => (isUnit ? api.unit(selection.propertyId) : Promise.resolve(null)),
    [isUnit, selection.propertyId],
  )

  if (!isUnit) {
    return (
      <aside className="pointer-events-auto absolute right-3 top-3 z-30 w-80 rounded-xl panel p-4" data-testid="property-sidebar">
        <p className="section-title">Property / Unit Details</p>
        <p className="mt-2 text-sm text-slate-400">
          {selection.mode === 'building'
            ? 'Building selected. Pick a floor in the explorer, then a unit — or click a unit in the 3D scene.'
            : selection.mode === 'floor'
              ? 'Floor selected. Choose a unit from the floor plan below or in the 3D scene.'
              : 'Search a ULPIN or pick a parcel / building to drill into the 3D property hierarchy.'}
        </p>
      </aside>
    )
  }

  const u = data?.unit
  const h = data?.hierarchy
  const g = data?.governance || {}

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
              </ul>
            </Section>

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
