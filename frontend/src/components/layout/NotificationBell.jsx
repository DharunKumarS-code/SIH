import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { api } from '../../lib/api.js'
import { dateShort } from '../../lib/format.js'

export function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const load = () => api.notifications().then(setItems).catch(() => setItems([]))

  useEffect(() => {
    load()
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const unread = items.filter((n) => !n.read).length

  const markRead = async (n) => {
    await api.markNotificationRead(n.notificationId).catch(() => {})
    load()
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
        <div className="panel absolute right-0 top-11 z-40 w-80 rounded-lg p-2">
          <p className="px-2 py-1 section-title">Notifications</p>
          <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
            {items.length === 0 && <li className="px-2 py-3 text-xs text-slate-400">No notifications.</li>}
            {items.map((n) => (
              <li key={n.notificationId}>
                <button
                  onClick={() => markRead(n)}
                  className="block w-full px-2 py-2 text-left hover:bg-white/5"
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${n.read ? 'text-slate-400' : 'text-white'}`}>{n.kind}</span>
                    <span className="text-[10px] text-slate-500">{dateShort(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{n.message}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
