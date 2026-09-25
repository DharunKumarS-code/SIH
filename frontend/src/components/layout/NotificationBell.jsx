import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { dateShort } from '../../lib/format.js'

const dateTime = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime())
    ? String(d)
    : dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const ref = useRef(null)

  const load = () => api.notifications().then(setItems).catch(() => setItems([]))

  useEffect(() => {
    load()
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e) => e.key === 'Escape' && setSelected(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const unread = items.filter((n) => !n.read).length

  const markRead = async (n) => {
    await api.markNotificationRead(n.notificationId).catch(() => {})
    load()
  }

  const openNotification = (n) => {
    setSelected(n)
    setOpen(false)
    if (!n.read) markRead(n)
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-ghost relative"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications (${unread} unread)`}
        data-testid="notif-bell"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="panel absolute right-0 top-11 z-40 w-80 p-2">
          <p className="px-2 py-1 section-title">Notifications</p>
          <ul className="max-h-80 divide-y divide-slate-200 overflow-y-auto">
            {items.length === 0 && <li className="px-2 py-3 text-xs text-slate-500">No notifications.</li>}
            {items.map((n) => (
              <li key={n.notificationId}>
                <button
                  onClick={() => openNotification(n)}
                  className="block w-full px-2 py-2 text-left hover:bg-slate-100"
                  type="button"
                  data-testid="notif-item"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${n.read ? 'text-slate-500' : 'text-slate-900'}`}>{n.kind}</span>
                    <span className="text-[10px] text-slate-500">{dateShort(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notif-detail-title"
            className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="notif-detail-title" className="font-display text-lg font-semibold text-slate-900">
                {selected.kind}
              </h2>
              <button
                onClick={() => setSelected(null)}
                className="btn-ghost !px-2 !py-1"
                aria-label="Close notification"
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{selected.message}</p>

            <div className="mt-6 border-t border-slate-100 pt-3">
              <p className="section-title mb-1">Details</p>
              <div className="kv-row">
                <span className="kv-label">Type</span>
                <span className="kv-value">{selected.kind || '—'}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Date &amp; time</span>
                <span className="kv-value">{dateTime(selected.createdAt)}</span>
              </div>
              {selected.entityRef && (
                <div className="kv-row">
                  <span className="kv-label">Related reference</span>
                  <span className="kv-value">{selected.entityRef}</span>
                </div>
              )}
              <div className="kv-row">
                <span className="kv-label">Status</span>
                <span className="kv-value">{selected.read ? 'Read' : 'Unread'}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={() => setSelected(null)} className="btn-primary" type="button">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
