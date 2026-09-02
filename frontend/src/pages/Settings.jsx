import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import {
  PageHeader, PageScroll, Card, KeyValue, Badge, Spinner, ErrorNote, DemoTag,
} from '../components/ui/primitives.jsx'
import { APP_DISCLAIMER } from '../lib/constants.js'

export default function Settings() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useApi(() => api.systemStatus(), [])

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
                <li key={k} className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5 text-sm last:border-0">
                  <span className="text-slate-300">{k}</span>
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
          <p className="text-xs leading-relaxed text-slate-400">{APP_DISCLAIMER}</p>
          {data && <p className="mt-2 text-[11px] text-gold">{data.disclaimer}</p>}
        </Card>
      </div>
    </PageScroll>
  )
}
