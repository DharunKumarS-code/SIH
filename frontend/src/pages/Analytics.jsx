import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, Card, Spinner, ErrorNote, DemoTag } from '../components/ui/primitives.jsx'
import { BarCard, PieCard, LineCard } from '../components/charts/Charts.jsx'

export default function Analytics() {
  const { data, error, loading, reload } = useApi(() => api.analytics(), [])

  return (
    <PageScroll>
      <PageHeader title="Analytics" subtitle="Land use, building density, property distribution, tax and dispute analytics">
        <DemoTag label="DEMO ANALYTICS" />
      </PageHeader>
      {loading && <Spinner />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PieCard title="Land Use" data={data.landUse} />
            <BarCard title="Bedroom Mix (residential units)" data={data.bedroomMix} />
            <BarCard title="Building Density (units per 1000 m² footprint)" data={data.buildingDensity} />
            <PieCard title="Property Tax by Status" data={data.taxByStatus} />
            <BarCard title="Disputes by Type" data={data.disputeByType} />
            <LineCard title="Construction Growth (buildings completed by year)" data={data.constructionGrowth} />
            <BarCard title="Approval Analytics" data={data.approvalAnalytics} />
            <PieCard title="Unit Facing Mix" data={data.facingMix} />
          </div>
          <Card className="mt-3" title="Building Density Heatmap (data)">
            <p className="mb-2 text-xs text-slate-500">
              Weighted points used by the 3D map’s density visualisation. Open the 3D Map for the spatial heatmap.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {data.heatmap.map((h) => (
                <div key={h.buildingId} className="rounded bg-slate-50 p-2 text-xs">
                  <div className="font-mono text-[10px] text-slate-500">{h.buildingId.split('-').pop()}</div>
                  <div className="text-lg font-bold text-slate-900">{h.weight}</div>
                  <div className="text-slate-500">units</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </PageScroll>
  )
}
