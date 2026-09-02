import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Box } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { num } from '../lib/format.js'
import {
  PageHeader, PageScroll, DataTable, Badge, Card, KeyValue, Spinner, ErrorNote,
} from '../components/ui/primitives.jsx'

export default function LandParcels() {
  const { ulpin } = useParams()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const list = useApi(() => api.parcels(q ? { q } : undefined), [q])
  const detail = useApi(() => (ulpin ? api.parcel(ulpin) : Promise.resolve(null)), [ulpin])

  return (
    <PageScroll>
      <PageHeader title="Land Parcels" subtitle="Cadastral parcels with ULPIN, land use and governance status" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <input
            className="input mb-3"
            placeholder="Filter by ULPIN / Parcel ID / Survey No."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {list.loading && <Spinner />}
          <ErrorNote error={list.error} onRetry={list.reload} />
          {list.data && (
            <DataTable
              rowKey={(r) => r.ulpin}
              onRowClick={(r) => navigate(`/parcels/${encodeURIComponent(r.ulpin)}`)}
              columns={[
                { key: 'ulpin', header: 'ULPIN', render: (r) => <span className="font-mono text-xs text-white">{r.ulpin}</span> },
                { key: 'landUse', header: 'Land Use' },
                { key: 'areaSqft', header: 'Area (sq.ft)', render: (r) => num(r.areaSqft) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
              ]}
              rows={list.data}
            />
          )}
        </div>

        <div>
          {!ulpin && <Card title="Parcel detail"><p className="text-sm text-slate-400">Select a parcel to view its full record and 3D property.</p></Card>}
          {detail.loading && <Spinner />}
          <ErrorNote error={detail.error} onRetry={detail.reload} />
          {detail.data && (
            <Card
              title={`Parcel — ${detail.data.parcel.ulpin}`}
              right={<button className="btn-primary" onClick={() => navigate(`/map?ulpin=${encodeURIComponent(ulpin)}`)}><Box size={14} /> View 3D Property</button>}
            >
              <KeyValue
                data={{
                  'Parcel ID': detail.data.parcel.parcelId,
                  'Survey Number': detail.data.parcel.surveyNumber,
                  Village: detail.data.parcel.village,
                  Taluk: detail.data.parcel.taluk,
                  District: detail.data.parcel.district,
                  'Land Use': detail.data.parcel.landUse,
                  'Area (sq.ft)': num(detail.data.parcel.areaSqft),
                  'Ownership Status': detail.data.parcel.ownershipStatus,
                  'Registration Status': detail.data.parcel.registrationStatus,
                  'Encumbrance Status': detail.data.parcel.encumbranceStatus,
                  'Property Tax Status': detail.data.parcel.propertyTaxStatus,
                  'Building Status': detail.data.parcel.buildingStatus,
                }}
              />
              <p className="mt-3 section-title">Buildings on this parcel</p>
              <ul className="mt-1 space-y-1">
                {detail.data.buildings.map((b) => (
                  <li key={b.buildingId}>
                    <button
                      className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
                      onClick={() => navigate(`/map?building=${encodeURIComponent(b.buildingId)}`)}
                    >
                      <span className="text-white">{b.name}</span>
                      <span className="text-xs text-slate-400">{b.totalFloors} floors · {b.unitCount} units</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </PageScroll>
  )
}
