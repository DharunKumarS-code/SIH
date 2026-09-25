import { useNavigate } from 'react-router-dom'
import {
  Layers, Building2, Fingerprint, ShieldCheck, ArrowLeftRight, Clock, Gavel, Receipt,
} from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { num } from '../lib/format.js'
import { PageHeader, StatStrip, StatStripItem, Spinner, ErrorNote, Card } from '../components/ui/primitives.jsx'
import { BarCard, PieCard, LineCard } from '../components/charts/Charts.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

export default function Dashboard() {
  const { data, error, loading, reload } = useApi(() => api.dashboard(), [])
  const navigate = useNavigate()

  if (loading) return <Scroll><Spinner label="Loading dashboard…" /></Scroll>
  if (error) return <Scroll><ErrorNote error={error} onRetry={reload} /></Scroll>

  const k = data.kpis
  const c = data.charts

  const kpis = [
    ['Total Parcels', num(k.totalParcels), Layers],
    ['Registered Buildings', num(k.registeredBuildings), Building2],
    ['ULPIN Assigned', num(k.ulpinAssigned), Fingerprint],
    ['Verified Properties', num(k.verifiedProperties), ShieldCheck],
    ['Active Transactions', num(k.activeTransactions), ArrowLeftRight],
    ['Pending Approvals', num(k.pendingApprovals), Clock],
    ['Disputes', num(k.disputes), Gavel],
    ['Property Tax Records', num(k.propertyTaxRecords), Receipt],
  ]

  return (
    <Scroll>
      <PageHeader title="Government Dashboard" subtitle="Chennai — OMR / Sholinganallur demonstration area">
        <button className="btn-primary" onClick={() => navigate('/map')}>
          Open 3D Map
        </button>
      </PageHeader>

      <div className="space-y-3">
        <StatStrip>
          {kpis.slice(0, 4).map(([label, value, icon]) => (
            <StatStripItem key={label} label={label} value={value} icon={icon} />
          ))}
        </StatStrip>
        <StatStrip>
          {kpis.slice(4).map(([label, value, icon]) => (
            <StatStripItem key={label} label={label} value={value} icon={icon} />
          ))}
        </StatStrip>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PieCard title="Land Use Distribution" data={c.landUseDistribution} />
        <BarCard title="Building Construction Status" data={c.buildingStatus} />
        <BarCard title="Building Approval Status" data={c.approvalStatus} />
        <PieCard title="Property Type Distribution" data={c.propertyTypeDistribution} />
        <LineCard title="Registration Trend (by year)" data={c.registrationTrend} />
        <BarCard title="Units per Building" data={c.unitsPerBuilding} />
      </div>

      <Card className="mt-4" title="Demonstration Scenario">
        <p className="text-sm text-slate-600">
          Search <span className="font-mono text-slate-900">{PARCEL_ULPIN}</span> → open the 3D map → select building
          <b> B01</b> → floor <b>F02</b> → unit <b>U201</b>. The unit resolves to the prototype identifier{' '}
          <span className="font-mono text-cyan">{PARCEL_ULPIN}-B01-F02-U201</span> with its own owner, documents and
          governance record, and can be isolated in 3D.
        </p>
        <button className="btn-ghost mt-3" onClick={() => navigate(`/map?unit=${PARCEL_ULPIN}-B01-F02-U201`)}>
          Run the scenario
        </button>
      </Card>
    </Scroll>
  )
}

function Scroll({ children }) {
  return <div className="h-full overflow-y-auto p-5">{children}</div>
}
