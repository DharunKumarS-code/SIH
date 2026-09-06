import { useNavigate } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { dateShort } from '../lib/format.js'
import { PageHeader, PageScroll, DataTable, Badge, Spinner, ErrorNote, DemoTag } from '../components/ui/primitives.jsx'

export default function Disputes() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi(() => api.disputes(), [])

  return (
    <PageScroll>
      <PageHeader title="Dispute Management" subtitle="Disputes linked to ULPIN / parcel / building / floor / unit">
        <DemoTag label="DEMO DATA" />
      </PageHeader>
      {loading && <Spinner />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <DataTable
          rowKey={(r) => r.disputeId}
          onRowClick={(r) =>
            r.propertyId
              ? navigate(`/map?unit=${encodeURIComponent(r.propertyId)}`)
              : navigate(`/map?ulpin=${encodeURIComponent(r.ulpin)}`)
          }
          columns={[
            { key: 'disputeId', header: 'Dispute ID' },
            { key: 'scope', header: 'Scope' },
            {
              key: 'ref',
              header: 'Property / Parcel',
              render: (r) => <span className="font-mono text-xs text-slate-900">{r.propertyId || r.ulpin}</span>,
            },
            { key: 'type', header: 'Type' },
            { key: 'filedOn', header: 'Filed', render: (r) => dateShort(r.filedOn) },
            { key: 'parties', header: 'Parties', render: (r) => (r.parties || []).join(' vs ') },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            { key: 'act', header: '', render: () => <span className="btn-ghost !py-1"><MapPin size={12} /> Map</span> },
          ]}
          rows={data}
        />
      )}
    </PageScroll>
  )
}
