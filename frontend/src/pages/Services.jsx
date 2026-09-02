import { useState } from 'react'
import clsx from 'clsx'
import { Plus, CheckCircle2 } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { dateShort } from '../lib/format.js'
import { PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote } from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

const TYPES = ['Ownership Verification', 'Name Transfer', 'Encumbrance Certificate', 'Property Tax Correction', 'Dispute Filing']
const WORKFLOW = [
  'Land Parcel Registered', 'Document Verification', 'Parcel / Boundary Verification', 'Building Plan Submitted',
  'Technical / Zoning Verification', 'Government Officer Review', 'Approved / Rejected', 'Construction',
  'Survey / Inspection', '3D Building Model', 'Floor Extraction', 'Unit Extraction', '3D Property Identifier Generated',
]

export default function Services() {
  const { can } = useAuth()
  const { data, error, loading, reload } = useApi(() => api.services(), [])
  const [form, setForm] = useState({ type: TYPES[0], ulpin: PARCEL_ULPIN, propertyId: `${PARCEL_ULPIN}-B01-F02-U201`, note: '' })
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createService(form)
      reload()
    } finally {
      setBusy(false)
    }
  }

  const advance = async (id, decision) => {
    await api.advanceService(id, { decision }).catch(() => {})
    reload()
  }

  return (
    <PageScroll>
      <PageHeader title="Citizen Services & Workflow" subtitle="Service requests move through the land-governance workflow" />

      <Card className="mb-4" title="End-to-end demonstration workflow">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {WORKFLOW.map((s, i, a) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="rounded bg-white/5 px-2 py-1 text-slate-300">{s}</span>
              {i < a.length - 1 && <span className="text-slate-600">↓</span>}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {loading && <Spinner />}
          <ErrorNote error={error} onRetry={reload} />
          <div className="space-y-2">
            {(data || []).map((s) => (
              <button
                key={s.requestId}
                onClick={() => setSelected(s)}
                className={clsx(
                  'w-full rounded-lg border p-3 text-left',
                  selected?.requestId === s.requestId ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/10',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{s.type}</span>
                  <Badge status={s.status}>{s.status}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {s.requestId} · {s.ulpin}
                  {s.propertyId ? ` · ${s.propertyId}` : ''} · {dateShort(s.submittedOn)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Stage: {s.stage}</p>
              </button>
            ))}
            {data && data.length === 0 && <p className="text-sm text-slate-400">No service requests yet.</p>}
          </div>

          {selected && (
            <Card className="mt-3" title={`${selected.requestId} — timeline`}>
              <ol className="space-y-2">
                {(selected.history || []).map((h, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    <div>
                      <p className="font-semibold text-slate-200">{h.stage}</p>
                      <p className="text-slate-500">{dateShort(h.at)} · {h.by}{h.note ? ` — ${h.note}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {can('service:process') && !['Approved', 'Rejected'].includes(selected.stage) && (
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary" onClick={() => advance(selected.requestId, 'advance')}>Advance stage</button>
                  <button className="btn-danger" onClick={() => advance(selected.requestId, 'reject')}>Reject</button>
                </div>
              )}
            </Card>
          )}
        </div>

        {can('service:create') && (
          <Card title="New service request">
            <form onSubmit={submit} className="space-y-2">
              <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <input className="input" value={form.ulpin} onChange={(e) => setForm((f) => ({ ...f, ulpin: e.target.value }))} placeholder="ULPIN" />
              <input className="input" value={form.propertyId} onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))} placeholder="Prototype 3D Property ID (optional)" />
              <textarea className="input" rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Note" />
              <button className="btn-primary w-full justify-center" disabled={busy}>
                <Plus size={14} /> {busy ? 'Submitting…' : 'Submit request'}
              </button>
            </form>
          </Card>
        )}
      </div>
    </PageScroll>
  )
}
