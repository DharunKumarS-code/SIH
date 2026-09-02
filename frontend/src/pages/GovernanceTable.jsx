import { useState } from 'react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { inr, num } from '../lib/format.js'
import {
  PageHeader, PageScroll, Card, KeyValue, Badge, DataTable, Spinner, ErrorNote, DemoTag,
} from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

const CONFIG = {
  ror: {
    title: 'Land Records (Record of Rights)',
    subtitle: 'Parcel-level RoR from the Land Records demo adapter',
    load: (ulpin) => api.ror(ulpin),
    render: (d) => <KeyValue data={d.recordOfRights} />,
  },
  registration: {
    title: 'Registration Records',
    subtitle: 'Sub-Registrar deed registrations (parcel + apartment level)',
    load: (ulpin) => api.registration(ulpin),
    render: (rows) => (
      <DataTable
        rowKey={(r) => r.registrationId}
        columns={[
          { key: 'docNumber', header: 'Doc No.' },
          { key: 'natureOfDeed', header: 'Deed' },
          { key: 'scope', header: 'Scope' },
          { key: 'registeredOn', header: 'Registered', render: (r) => r.registeredOn?.slice(0, 10) },
          { key: 'considerationValueLakh', header: '₹ (lakh)', render: (r) => num(r.considerationValueLakh) },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]}
        rows={Array.isArray(rows) ? rows : []}
      />
    ),
  },
  approval: {
    title: 'Building Permissions',
    subtitle: 'CMDA building plan approvals for each block',
    load: async () => {
      const { buildings } = await api.parcel(PARCEL_ULPIN)
      return Promise.all(buildings.map((b) => api.buildingApproval(b.buildingId).catch(() => null)))
    },
    render: (rows) => (
      <DataTable
        rowKey={(r) => r?.approvalId}
        columns={[
          { key: 'buildingId', header: 'Building', render: (r) => <span className="font-mono text-xs">{r?.buildingId}</span> },
          { key: 'planNumber', header: 'Plan No.' },
          { key: 'authority', header: 'Authority' },
          { key: 'approvedFloors', header: 'Floors' },
          { key: 'approvedHeightM', header: 'Height (m)' },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r?.status} /> },
        ]}
        rows={(rows || []).filter(Boolean)}
      />
    ),
  },
  tax: {
    title: 'Property Tax',
    subtitle: 'Greater Chennai Corporation assessments (parcel + apartment level)',
    load: (ulpin) => api.propertyTax(ulpin),
    render: (d) => (
      <>
        <p className="mb-2 text-sm text-slate-300">
          Total outstanding: <span className="font-bold text-warn">{inr(d.totalDueRs)}</span>
        </p>
        <DataTable
          rowKey={(r) => r.taxId}
          columns={[
            { key: 'assessmentNumber', header: 'Assessment No.' },
            { key: 'scope', header: 'Scope' },
            { key: 'annualValueRs', header: 'Annual Value', render: (r) => inr(r.annualValueRs) },
            { key: 'halfYearlyTaxRs', header: 'Half-Yearly Tax', render: (r) => inr(r.halfYearlyTaxRs) },
            { key: 'dueAmountRs', header: 'Due', render: (r) => inr(r.dueAmountRs) },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          rows={d.assessments || []}
        />
      </>
    ),
  },
}

export default function GovernanceTable({ kind }) {
  const cfg = CONFIG[kind]
  const [ulpin, setUlpin] = useState(PARCEL_ULPIN)
  const { data, error, loading, reload } = useApi(() => cfg.load(ulpin), [kind, ulpin])

  return (
    <PageScroll>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle}>
        <DemoTag label="DEMO / MOCK INTEGRATION" />
      </PageHeader>
      <div className="mb-3 flex gap-2">
        <input className="input max-w-xs" value={ulpin} onChange={(e) => setUlpin(e.target.value)} placeholder="ULPIN" />
        <button className="btn-ghost" onClick={reload}>Refresh</button>
      </div>
      <Card>
        {loading && <Spinner />}
        <ErrorNote error={error} onRetry={reload} />
        {data && cfg.render(data)}
      </Card>
    </PageScroll>
  )
}
