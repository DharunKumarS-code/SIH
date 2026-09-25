import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Database, ShieldCheck, ClipboardList, FileText, History, ExternalLink } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import {
  PageHeader, PageScroll, Card, Badge, Stat, Spinner, ErrorNote, DataTable, DemoTag,
} from '../components/ui/primitives.jsx'
import { dateShort } from '../lib/format.js'

const TABS = [
  { id: 'sources', label: 'Data Sources', icon: Database },
  { id: 'quality', label: 'Data Quality', icon: ShieldCheck },
  { id: 'reviews', label: 'Pending Reviews', icon: ClipboardList },
  { id: 'requests', label: 'Governance Requests', icon: ClipboardList },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'audit', label: 'Audit Trail', icon: History },
]

function qualityTone(s) {
  if (s === 'VALID') return 'Verified'
  if (s === 'ERROR') return 'Disputed'
  if (s === 'WARNING' || s === 'REVIEW_REQUIRED') return 'Under Review'
  return 'Submitted'
}

export default function Governance() {
  const { data, loading, error, reload } = useApi(() => api.governanceOverview(), [])
  const [tab, setTab] = useState('sources')
  const d = data || {}

  return (
    <PageScroll>
      <PageHeader
        title="Governance"
        subtitle="Data sources · data quality · pending reviews · governance requests · documents · audit trail"
      >
        <DemoTag label="READ-ONLY ROLL-UP" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-slate-200 bg-surface p-3 text-[12px] leading-relaxed text-slate-600">
        {d.disclaimer || 'Governance overview — a read-only roll-up of existing platform records. No live government connectivity; Land Records / Registration / Property Tax integrations are DEMO / MOCK adapters.'}
      </p>

      {loading && <Spinner />}
      <ErrorNote error={error} onRetry={reload} />

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Parcels" value={d.holdings?.parcels ?? 0} icon={Landmark} />
            <Stat label="Buildings" value={d.holdings?.buildings ?? 0} />
            <Stat label="Units" value={d.holdings?.units ?? 0} />
            <Stat label="3D Identifiers" value={d.holdings?.proposed3DIdentifiers ?? 0} />
            <Stat label="Pending reviews" value={d.pendingReviews?.total ?? 0} accent="text-warn" />
            <Stat label="Open requests" value={d.governanceRequests?.open ?? 0} accent="text-warn" />
          </div>

          <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  data-testid={`governance-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={
                    tab === t.id
                      ? 'flex items-center gap-1.5 border-b-2 border-primary px-3 py-2 text-[13px] font-semibold text-primary'
                      : 'flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-[13px] text-slate-500 hover:text-slate-800'
                  }
                >
                  <Icon size={13} /> {t.label}
                </button>
              )
            })}
          </div>

          <div className="mt-4" data-testid={`governance-panel-${tab}`}>
            {tab === 'sources' && (
              <Card title="Official ULPIN / land-data sources (Phase 1 investigation)" right={<Badge status={d.dataSources?.chennaiAvailability === 'UNAVAILABLE' ? 'Under Review' : 'Verified'}>{d.dataSources?.chennaiAvailability}</Badge>}>
                <p className="mb-3 text-[12px] text-slate-600">{d.dataSources?.summary}</p>
                <DataTable
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'organization', header: 'Organisation', render: (r) => <span className="text-[12px]">{r.organization}</span> },
                    { key: 'dataset', header: 'Dataset', render: (r) => <span className="text-[12px]">{r.dataset}</span> },
                    { key: 'chennaiAvailability', header: 'Chennai', render: (r) => <Badge status={r.chennaiAvailability === 'UNAVAILABLE' ? 'Under Review' : 'Verified'}>{r.chennaiAvailability}</Badge> },
                    { key: 'accessBarrier', header: 'Access barrier', render: (r) => <span className="text-[11px] text-slate-500">{r.accessBarrier}</span> },
                    { key: 'url', header: '', render: (r) => (r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink size={13} /></a> : null) },
                  ]}
                  rows={d.dataSources?.sources || []}
                  empty="No registered sources."
                />
                <p className="mt-3 text-[11px] text-slate-500">
                  Full write-up: <Link to="/settings" className="text-primary underline">Settings → Land Data Sources &amp; Provenance</Link> ·
                  <code className="mx-1">docs/13-official-ulpin-data-investigation.md</code>
                </p>
              </Card>
            )}

            {tab === 'quality' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Topology validation (Phase 7)" right={d.dataQuality?.topology && <Badge status={qualityTone(d.dataQuality.topology.overallStatus)}>{d.dataQuality.topology.overallStatus}</Badge>}>
                  {d.dataQuality?.topology ? (
                    <div className="grid grid-cols-4 gap-2">
                      <Stat label="Valid" value={d.dataQuality.topology.summary?.valid ?? 0} />
                      <Stat label="Warning" value={d.dataQuality.topology.summary?.warning ?? 0} />
                      <Stat label="Error" value={d.dataQuality.topology.summary?.error ?? 0} />
                      <Stat label="Review" value={d.dataQuality.topology.summary?.reviewRequired ?? 0} />
                    </div>
                  ) : <p className="text-[12px] text-slate-500">No topology validation run yet. <Link to="/topology" className="text-primary underline">Run one →</Link></p>}
                </Card>
                <Card title="Underground infrastructure (Phase 8)" right={d.dataQuality?.infrastructure && <Badge status={qualityTone(d.dataQuality.infrastructure.overallStatus)}>{d.dataQuality.infrastructure.overallStatus}</Badge>}>
                  {d.dataQuality?.infrastructure ? (
                    <div className="grid grid-cols-4 gap-2">
                      <Stat label="Valid" value={d.dataQuality.infrastructure.summary?.valid ?? 0} />
                      <Stat label="Warning" value={d.dataQuality.infrastructure.summary?.warning ?? 0} />
                      <Stat label="Error" value={d.dataQuality.infrastructure.summary?.error ?? 0} />
                      <Stat label="Review" value={d.dataQuality.infrastructure.summary?.reviewRequired ?? 0} />
                    </div>
                  ) : <p className="text-[12px] text-slate-500">No infrastructure validation run yet. <Link to="/underground" className="text-primary underline">Run one →</Link></p>}
                </Card>
              </div>
            )}

            {tab === 'reviews' && (
              <Card title="Pending reviews">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Geometry review proposals" value={d.pendingReviews?.geometryProposals ?? 0} hint={`${d.pendingReviews?.geometryProposalsTotal ?? 0} total`} />
                  <Stat label="AI jobs awaiting review" value={d.pendingReviews?.aiJobs ?? 0} />
                  <Stat label="Total pending" value={d.pendingReviews?.total ?? 0} accent="text-warn" />
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Geometry proposals are reviewed in <Link to="/gnss" className="text-primary underline">GNSS / CORS Control</Link>;
                  AI outputs in <Link to="/ai-buildings" className="text-primary underline">Building Extraction</Link> /
                  <Link to="/ai-floorplans" className="text-primary underline"> Floor Plan Segmentation</Link>.
                  A proposal never changes authoritative geometry without an explicit authorised accept.
                </p>
              </Card>
            )}

            {tab === 'requests' && (
              <Card title="Governance / citizen service requests">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total" value={d.governanceRequests?.total ?? 0} />
                  <Stat label="Open" value={d.governanceRequests?.open ?? 0} accent="text-warn" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(d.governanceRequests?.byStatus || {}).map(([k, v]) => (
                    <Badge key={k} status={qualityTone(k)}>{k}: {v}</Badge>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Full workflow: <Link to="/services" className="text-primary underline">Services</Link>.
                </p>
              </Card>
            )}

            {tab === 'documents' && (
              <Card title="Documents">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Document records" value={d.documents?.total ?? 0} icon={FileText} />
                </div>
                <p className="mt-3 text-[12px] text-slate-600">{d.documents?.note}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Individual documents are listed on each Parcel / Unit record and on
                  <Link to="/land-records" className="mx-1 text-primary underline">Land Records</Link>.
                </p>
              </Card>
            )}

            {tab === 'audit' && (
              <Card title="Audit trail (recent)">
                <DataTable
                  rowKey={(r) => r.logId}
                  columns={[
                    { key: 'at', header: 'When', render: (r) => <span className="text-[12px] text-slate-500">{dateShort(r.at)}</span> },
                    { key: 'user', header: 'User', render: (r) => <span className="text-[12px] font-medium">{r.user}</span> },
                    { key: 'action', header: 'Action', render: (r) => <Badge>{r.action}</Badge> },
                    { key: 'entityType', header: 'Entity', render: (r) => <span className="text-[12px]">{r.entityType}</span> },
                    { key: 'entityId', header: 'ID', render: (r) => <span className="font-mono text-[11px] text-slate-500 break-all">{r.entityId}</span> },
                  ]}
                  rows={d.audit?.recent || []}
                  empty="No audit entries."
                />
                <p className="mt-3 text-[11px] text-slate-500">
                  Every verify / review / geometry-accept / AI inference is recorded. Administrators see the full trail
                  under <Link to="/settings" className="text-primary underline">Settings</Link>.
                </p>
              </Card>
            )}
          </div>
        </>
      )}
    </PageScroll>
  )
}
