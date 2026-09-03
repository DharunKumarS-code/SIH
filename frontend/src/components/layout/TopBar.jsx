import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { Menu, Search, MapPin, LogOut, Building, Home, User2, Layers, Layers3 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSelection } from '../../context/SelectionContext.jsx'
import { api } from '../../lib/api.js'
import { NotificationBell } from './NotificationBell.jsx'

const KIND_ICON = { unit: Home, building: Building, floor: Layers3, parcel: Layers, owner: User2 }

export function TopBar({ onToggleNav }) {
  const { user, logout } = useAuth()
  const { selectParcel, selectBuilding, selectFloor, selectUnit, localities, area, selectArea } = useSelection()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const { results: r } = await api.search(q.trim())
        setResults(r)
        setOpen(true)
      } catch {
        setResults([])
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const choose = (r) => {
    setOpen(false)
    setQ('')
    navigate('/map')
    if (r.kind === 'unit') selectUnit(r.ref)
    else if (r.kind === 'building') selectBuilding(r.ref.buildingId, r.ref.ulpin)
    else if (r.kind === 'floor') selectFloor(r.ref.buildingId, r.ref.floorNumber, r.ref.ulpin)
    else if (r.kind === 'owner') selectUnit(r.ref)
    else selectParcel(r.ref.ulpin)
  }

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-navy-900 px-3">
      <button className="btn-ghost lg:hidden" onClick={onToggleNav} aria-label="Toggle navigation">
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-2 pr-2">
        <div className="grid h-8 w-8 place-items-center rounded bg-primary font-black text-white">LS</div>
        <div className="hidden sm:block leading-tight">
          <div className="text-sm font-extrabold tracking-tight text-white">LAND STACK</div>
          <div className="text-[10px] text-slate-400">3D Land Governance · Prototype</div>
        </div>
      </div>

      <div ref={boxRef} className="relative mx-auto w-full max-w-xl">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search ULPIN · Survey No. · Subdivision · Locality · Building · Floor · Unit · Owner"
          className="input pl-9"
          aria-label="Global search"
          data-testid="global-search"
        />
        {open && (
          <ul
            className="panel absolute left-0 right-0 top-11 z-40 max-h-80 overflow-y-auto rounded-lg p-1"
            data-testid="search-results"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">No matches for “{q}”.</li>
            ) : (
              results.map((r, i) => {
                const Icon = KIND_ICON[r.kind] || MapPin
                return (
                  <li key={`${r.kind}-${r.title}-${i}`}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-primary/15"
                    >
                      <Icon size={15} className="text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{r.title}</span>
                        <span className="block truncate text-xs text-slate-400">{r.subtitle}</span>
                      </span>
                      {r.kind === 'parcel' && r.verification && (
                        <span
                          className={clsx(
                            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                            r.verification === 'OFFICIAL'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-gold/20 text-gold',
                          )}
                        >
                          {r.verification}
                        </span>
                      )}
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{r.kind}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      <div className="hidden items-center gap-1 rounded-md bg-white/5 pl-2 pr-1 py-1 text-xs text-slate-300 md:flex">
        <MapPin size={13} className="text-cyan" />
        <span className="text-slate-400">Chennai ·</span>
        <select
          value={area?.id || ''}
          onChange={(e) => {
            navigate('/map')
            selectArea(e.target.value)
          }}
          className="bg-transparent pr-1 font-semibold text-white outline-none [&>option]:bg-navy-900"
          aria-label="Chennai area"
          data-testid="area-select"
        >
          {(localities || []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <NotificationBell />

      <div className="flex items-center gap-2">
        <div className="hidden text-right sm:block">
          <div className="text-xs font-semibold text-white">{user?.name}</div>
          <div className="text-[10px] text-slate-400">{user?.role}</div>
        </div>
        <button className="btn-ghost" onClick={logout} aria-label="Sign out" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
