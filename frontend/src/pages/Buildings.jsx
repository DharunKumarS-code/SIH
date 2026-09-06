import { useNavigate } from 'react-router-dom'
import { Box } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, DataTable, Badge, Spinner, ErrorNote } from '../components/ui/primitives.jsx'

export default function Buildings() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi(() => api.buildings(), [])

  return (
    <PageScroll>
      <PageHeader title="Buildings" subtitle="Apartment blocks on the demonstration parcel — each drills into floors and individual units" />
      {loading && <Spinner />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <DataTable
          rowKey={(r) => r.buildingId}
          onRowClick={(r) => navigate(`/map?building=${encodeURIComponent(r.buildingId)}`)}
          columns={[
            { key: 'name', header: 'Building', render: (r) => <span className="font-semibold text-slate-900">{r.name}</span> },
            { key: 'buildingId', header: 'Building ID', render: (r) => <span className="font-mono text-xs">{r.buildingId}</span> },
            { key: 'totalFloors', header: 'Floors' },
            { key: 'unitCount', header: 'Units' },
            { key: 'heightM', header: 'Height (m)' },
            { key: 'constructionType', header: 'Type' },
            { key: 'constructionStatus', header: 'Status', render: (r) => <Badge status={r.constructionStatus} /> },
            { key: 'act', header: '', render: () => <span className="btn-ghost !py-1"><Box size={13} /> 3D</span> },
          ]}
          rows={data}
        />
      )}
    </PageScroll>
  )
}
