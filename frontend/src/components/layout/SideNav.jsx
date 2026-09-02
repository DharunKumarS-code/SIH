import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { NAV } from '../../lib/nav.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { SystemStatusBadge } from './SystemStatusBadge.jsx'

export function SideNav({ open, onClose }) {
  const { user, can } = useAuth()
  const items = NAV.filter((n) => {
    if (n.role && user?.role !== n.role) return false
    if (n.perm && !can(n.perm)) return false
    return true
  })

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={onClose} />}
      <nav
        className={clsx(
          'z-30 flex w-60 shrink-0 flex-col border-r border-white/10 bg-navy-900',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:top-14 max-lg:transition-transform',
          open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-3 pt-3 lg:hidden">
          <span className="section-title">Navigation</span>
          <button className="btn-ghost" onClick={onClose} aria-label="Close navigation">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </div>
        <SystemStatusBadge />
      </nav>
    </>
  )
}
