import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { api } from '../../lib/api.js'

export function SystemStatusBadge() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    api.systemStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const services = status?.services || {}
  const anyLive = status?.store?.mongoConnected

  return (
    <Link
      to="/settings"
      className="m-2 block rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs hover:bg-white/10"
      data-testid="system-status"
    >
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-200">
        <Activity size={12} className="text-cyan" />
        System Status
      </div>
      <ul className="space-y-0.5 text-[11px] text-slate-400">
        {Object.entries(services).slice(0, 4).map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="truncate">{k}</span>
            <span className={/Connected|Active/.test(v) && !/Demo/.test(v) ? 'text-ok' : 'text-warn'}>
              {v.split(' ')[0]}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2">
          <span>Database</span>
          <span className={anyLive ? 'text-ok' : 'text-warn'}>{anyLive ? 'MongoDB' : 'Demo'}</span>
        </li>
      </ul>
    </Link>
  )
}
