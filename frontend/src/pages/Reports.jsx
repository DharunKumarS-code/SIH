import { useState } from 'react'
import { Printer, FileDown } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, Card, KeyValue, Spinner, ErrorNote, DemoTag } from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

const PRESETS = {
  property: `${PARCEL_ULPIN}-B01-F02-U201`,
  parcel: PARCEL_ULPIN,
  building: `${PARCEL_ULPIN}-B02`,
}

export default function Reports() {
  const [kind, setKind] = useState('property')
  const [id, setId] = useState(PRESETS.property)
  const [state, setState] = useState({ loading: false, error: null, report: null })

  const generate = async () => {
    setState({ loading: true, error: null, report: null })
    try {
      const report = await api.report({ kind, id })
      setState({ loading: false, error: null, report })
    } catch (error) {
      setState({ loading: false, error, report: null })
    }
  }

  const exportCsv = () => {
    const r = state.report
    if (!r) return
    const lines = [['Section', 'Field', 'Value']]
    r.sections.forEach((s) => Object.entries(s.rows).forEach(([k, v]) => lines.push([s.heading, k, String(v)])))
    const csv = lines.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${r.title.replace(/\s+/g, '_')}.csv`
    a.click()
  }

  return (
    <PageScroll>
      <PageHeader title="Reports" subtitle="Property · Parcel · Building reports — view, print, export CSV">
        <DemoTag label="DEMO" />
      </PageHeader>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            Report type
            <select
              className="input mt-1"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setId(PRESETS[e.target.value])
              }}
            >
              <option value="property">Property Report</option>
              <option value="parcel">Parcel Report</option>
              <option value="building">Building Report</option>
            </select>
          </label>
          <label className="flex-1 text-xs text-slate-400">
            Identifier
            <input className="input mt-1" value={id} onChange={(e) => setId(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={generate}>Generate</button>
        </div>
      </Card>

      {state.loading && <Spinner />}
      <ErrorNote error={state.error} />

      {state.report && (
        <Card
          title={state.report.title}
          right={
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => window.print()}><Printer size={14} /> Print</button>
              <button className="btn-ghost" onClick={exportCsv}><FileDown size={14} /> CSV</button>
            </div>
          }
        >
          <p className="mb-3 text-[11px] text-gold">{state.report.disclaimer}</p>
          {state.report.sections.map((s) => (
            <div key={s.heading} className="mb-3">
              <p className="section-title mb-1">{s.heading}</p>
              <KeyValue data={s.rows} />
            </div>
          ))}
        </Card>
      )}
    </PageScroll>
  )
}
