import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { NAV_GROUPS } from '../../lib/nav.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { SystemStatusBadge } from './SystemStatusBadge.jsx'

export function SideNav({ open, onClose }) {
  const { user, can } = useAuth()

  const groups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((n) => {
        if (n.role && user?.role !== n.role) return false
        if (n.perm && !can(n.perm)) return false
        return true
      }),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <nav
        className={clsx(
          'z-30 flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:top-14 max-lg:shadow-lg max-lg:transition-transform',
          open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between px-3 pt-3 lg:hidden">
          <span className="section-title">Navigation</span>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Close navigation">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((g, gi) => (
            <div key={g.group} className={clsx(gi > 0 && 'mt-4')}>
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.group}</p>
              <div className="space-y-0.5">
                {g.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onClose}
                    className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
        <SystemStatusBadge />
      </nav>
    </>
  )
}
