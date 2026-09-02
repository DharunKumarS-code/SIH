import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Box } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, Card, Badge, KeyValue, Spinner, ErrorNote, DemoTag } from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

export default function UlpinSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState(PARCEL_ULPIN)
  const [state, setState] = useState({ loading: false, error: null, results: null, parcel: null })

  const run = async (e) => {
    e?.preventDefault()
    setState({ loading: true, error: null, results: null, parcel: null })
    try {
      const { results } = await api.search(q.trim())
      let parcel = null
      const parcelHit = results.find((r) => r.kind === 'parcel')
      if (parcelHit) {
        parcel = await api.parcel(parcelHit.ref.ulpin).catch(() => null)
      }
      setState({ loading: false, error: null, results, parcel })
    } catch (err) {
      setState({ loading: false, error: err, results: null, parcel: null })
    }
  }

  return (
    <PageScroll>
      <PageHeader
        title="ULPIN Search"
        subtitle="Search by ULPIN, Prototype 3D Property ID, Building ID, Apartment Number, Owner, Survey No. or Address"
      />
      <form onSubmit={run} className="mb-4 flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. TN-CHN-123456789 or TN-CHN-123456789-B01-F02-U201" />
        <button className="btn-primary" type="submit"><Search size={15} /> Search</button>
      </form>

      {state.loading && <Spinner />}
      <ErrorNote error={state.error} />

      {state.parcel && (
        <Card
          className="mb-4"
          title={`Parcel — ${state.parcel.parcel.ulpin}`}
          right={<button className="btn-primary" onClick={() => navigate(`/map?ulpin=${encodeURIComponent(state.parcel.parcel.ulpin)}`)}><Box size={14} /> Explore in 3D</button>}
        >
          <KeyValue
            data={{
              Location: `${state.parcel.parcel.village}, ${state.parcel.parcel.taluk}, ${state.parcel.parcel.district}`,
              'Land Use': state.parcel.parcel.landUse,
              'Ownership Status': state.parcel.parcel.ownershipStatus,
              'Building Status': state.parcel.parcel.buildingStatus,
              'Property Tax Status': state.parcel.parcel.propertyTaxStatus,
              'Registration Status': state.parcel.parcel.registrationStatus,
            }}
          />
        </Card>
      )}

      {state.results && (
        <Card title={`Results (${state.results.length})`}>
          {state.results.length === 0 && <p className="text-sm text-slate-400">No matches.</p>}
          <ul className="divide-y divide-white/5">
            {state.results.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{r.title}</p>
                  <p className="truncate text-xs text-slate-400">{r.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{r.kind}</Badge>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      if (r.kind === 'unit') navigate(`/map?unit=${encodeURIComponent(r.ref.propertyId)}`)
                      else if (r.kind === 'building') navigate(`/map?building=${encodeURIComponent(r.ref.buildingId)}`)
                      else navigate(`/map?ulpin=${encodeURIComponent(r.ref.ulpin)}`)
                    }}
                  >
                    Open in 3D
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
            <DemoTag /> Apartment identifiers are Prototype 3D Property Identifiers derived from the parent ULPIN — not official ULPINs.
          </p>
        </Card>
      )}
    </PageScroll>
  )
}
