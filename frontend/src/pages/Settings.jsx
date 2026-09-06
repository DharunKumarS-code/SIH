import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import {
  PageHeader, PageScroll, Card, KeyValue, Badge, Spinner, ErrorNote, DemoTag,
} from '../components/ui/primitives.jsx'
import { APP_DISCLAIMER } from '../lib/constants.js'
import { LAND_SOURCES_FALLBACK } from '../lib/provenance.js'

export default function Settings() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useApi(() => api.systemStatus(), [])
  const sources = useApi(() => api.landSources(), [])
  const land = sources.data || LAND_SOURCES_FALLBACK

  return (
    <PageScroll>
      <PageHeader title="Settings & System Status" subtitle="Global system status and prototype configuration" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Signed-in user">
          <KeyValue data={{ Name: user?.name, Username: user?.username, Role: user?.role, Email: user?.email }} />
        </Card>

        <Card title="Global system status" right={<button className="btn-ghost" onClick={reload}>Refresh</button>}>
          {loading && <Spinner />}
          <ErrorNote error={error} onRetry={reload} />
          {data && (
            <ul className="space-y-1">
              {Object.entries(data.services).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-2 border-b border-slate-200 py-1.5 text-sm last:border-0">
                  <span className="text-slate-600">{k}</span>
                  <Badge status={/Connected|Active/.test(v) && !/Demo/.test(v) ? 'Verified' : 'Under Review'}>{v}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Data store">
          {data && (
            <KeyValue
              data={{
                Mode: data.store.mode,
                'MongoDB configured': String(data.store.mongoConfigured),
                'MongoDB connected': String(data.store.mongoConnected),
                Message: data.store.message,
                Region: data.store.meta?.region,
              }}
            />
          )}
        </Card>

        <Card title="Prototype disclaimer" right={<DemoTag />}>
          <p className="text-xs leading-relaxed text-slate-500">{APP_DISCLAIMER}</p>
          {data && <p className="mt-2 text-[11px] text-amber-700">{data.disclaimer}</p>}
        </Card>

        <Card
          title="Land Data Sources & Provenance"
          right={<Badge status="Under Review">Chennai ULPIN: {land.chennai?.status || 'UNAVAILABLE'}</Badge>}
          className="lg:col-span-2"
        >
          <p className="text-xs leading-relaxed text-amber-700" data-testid="ulpin-availability">
            Official Chennai ULPIN parcel data is <strong>UNAVAILABLE</strong> via public channels — every
            authoritative Government of India / Tamil Nadu source requires an Aadhaar OTP, a CAPTCHA, or a
            registered login, none of which this prototype bypasses. <strong>All parcels shown in the app are
            DEMO data</strong>, clearly labelled as such.
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            ULPIN is a {land.ulpinSpec?.length || 14}-digit identifier for a <strong>land parcel only</strong> —
            never a building, floor or apartment ({land.ulpinSpec?.authority}).
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-1 pr-3 font-semibold">Source</th>
                  <th className="py-1 pr-3 font-semibold">Dataset</th>
                  <th className="py-1 pr-3 font-semibold">Access barrier</th>
                  <th className="py-1 font-semibold">Chennai</th>
                </tr>
              </thead>
              <tbody>
                {(land.sources || []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-200 align-top last:border-0">
                    <td className="py-1.5 pr-3">
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {s.organization}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{s.dataset}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{s.accessBarrier}</td>
                    <td className="py-1.5">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold uppercase text-amber-700">
                        {s.chennaiAvailability}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {land.localities?.length > 0 && (
            <p className="mt-2 text-[10px] text-slate-500">
              Admin hierarchy:{' '}
              {land.localities.map((l) => `${l.name} (${l.adminLevel || '—'}, ${l.recordType || '—'})`).join(' · ')}.
              Chennai urban parcels are recorded in the Town Survey Land Register (TSLR), keyed by
              District → Taluk → Village/Town-Survey block → Survey No → Sub-Division.
            </p>
          )}
          <p className="mt-2 text-[10px] text-slate-600">
            See <code>docs/13-official-ulpin-data-investigation.md</code> for the full investigation.
          </p>
        </Card>
      </div>
    </PageScroll>
  )
}
