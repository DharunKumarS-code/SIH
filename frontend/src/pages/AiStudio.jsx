import { useEffect, useState } from 'react'
import { Sparkles, Play, Cpu } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DemoTag } from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

const PIPELINE = [
  'Satellite / Drone Image', 'Preprocessing', 'Building Segmentation', 'Building Footprint',
  'Height Estimation', '3D Building Generation', 'Floor Estimation', 'Property Unit Mapping',
]

export default function AiStudio() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const run = async (feature) => {
    setBusy(feature)
    setError(null)
    setResult(null)
    try {
      const r = await api.aiRun(feature, { ulpin: PARCEL_ULPIN, floor: 'F02', floorNumber: 2, units: 6 })
      setResult({ feature, r })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageScroll>
      <PageHeader title="AI Studio" subtitle="Building extraction & change-detection pipeline — plug-in architecture">
        <Badge status={status?.mode === 'connected' ? 'Verified' : 'Under Review'}>
          {status?.mode === 'connected' ? 'AI service connected' : 'AI service — Demo Mode'}
        </Badge>
      </PageHeader>

      <Card className="mb-4" title="Building Extraction Pipeline">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {PIPELINE.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="rounded bg-white/5 px-2 py-1 text-slate-300">{step}</span>
              {i < PIPELINE.length - 1 && <span className="text-slate-600">→</span>}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(status?.features || []).map((f) => (
          <Card key={f.key} title={f.name}>
            <p className="text-xs text-slate-400">
              <span className="text-slate-500">Input:</span> {f.input}
              <br />
              <span className="text-slate-500">Output:</span> {f.output}
            </p>
            <button className="btn-primary mt-3 w-full justify-center" disabled={busy === f.key} onClick={() => run(f.key)}>
              {busy === f.key ? <Spinner label="Running…" /> : <><Play size={14} /> Run inference</>}
            </button>
          </Card>
        ))}
      </div>

      <ErrorNote error={error} />

      {result && (
        <Card className="mt-4" title={`Result — ${result.feature}`} right={<DemoTag label="SIMULATED" />}>
          <p className="mb-2 flex items-center gap-2 text-xs text-gold">
            <Cpu size={13} /> {result.r.disclaimer}
          </p>
          <pre className="max-h-80 overflow-auto rounded bg-navy-950 p-3 text-[11px] text-slate-300">
            {JSON.stringify(result.r, null, 2)}
          </pre>
        </Card>
      )}

      <Card className="mt-4" title="Change Detection Workflow">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {['Previous imagery', 'Current imagery', 'AI comparison', 'Detected change', 'Officer review', 'Update property record'].map((s, i, a) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="rounded bg-white/5 px-2 py-1 text-slate-300">{s}</span>
              {i < a.length - 1 && <span className="text-slate-600">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <Sparkles size={12} /> Detected change classes: New Construction · Building Expansion · Demolition · No Significant Change.
        </p>
      </Card>
    </PageScroll>
  )
}
