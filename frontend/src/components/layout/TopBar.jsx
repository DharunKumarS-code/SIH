import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { Menu, Search, MapPin, LogOut, Building, Home, User2, Layers, Layers3, Waypoints, Boxes, Landmark, Sun, Moon } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSelection } from '../../context/SelectionContext.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { api } from '../../lib/api.js'
import { COIMBATORE_DEMO_PROPERTY } from '../../lib/constants.js'
import { NotificationBell } from './NotificationBell.jsx'

const KIND_ICON = { unit: Home, building: Building, floor: Layers3, parcel: Layers, owner: User2, infrastructure: Waypoints, identifier: Boxes, 'tngis-parcel': Landmark }

export function TopBar({ onToggleNav }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { selectParcel, selectBuilding, selectFloor, selectUnit, selectInfrastructure, selectTngisParcel, setLayerGroup, localities, area, selectArea, cityView, flyToRegion, regions, selectCoimbatoreDemo, selection } = useSelection()
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
    else if (r.kind === 'infrastructure') {
      if (r.ref.locality && r.ref.locality !== area?.id) selectArea(r.ref.locality)
      setLayerGroup(['undergroundInfrastructure'], true)
      selectInfrastructure(r.ref.infrastructureId)
    }
    else if (r.kind === 'identifier') {
      if (r.ref.locality && r.ref.locality !== area?.id) selectArea(r.ref.locality)
      if (r.ref.propertyId) selectUnit(r.ref) // reuse existing unit selection -> volume focus + sidebar
    }
    else if (r.kind === 'tngis-parcel') {
      if (r.ref.locality && r.ref.locality !== area?.id) selectArea(r.ref.locality)
      setLayerGroup(['tngisParcels'], true)
      selectTngisParcel(r.ref.sourceRecordId)
    }
    else selectParcel(r.ref.ulpin)
  }

  return (
    <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-surface px-3">
      <button className="btn-ghost lg:hidden !px-2" onClick={onToggleNav} aria-label="Toggle navigation">
        <Menu size={18} />
      </button>

      {/* Government masthead */}
      <div className="flex items-center gap-2.5 pr-2">
        <div className="grid h-9 w-9 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Landmark size={17} />
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Government &middot; Land Governance Portal
          </div>
          <div className="font-display text-sm font-semibold tracking-tight text-slate-900">PROPERTY 3D ULPIN</div>
          <div className="text-[10px] text-slate-500">Chennai 3D Cadastre</div>
        </div>
      </div>

      <div ref={boxRef} className="relative mx-auto w-full max-w-xl">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search ULPIN · Survey No. · Locality · Building · Floor · Unit · 3DPR"
          className="input pl-9"
          aria-label="Global search"
          data-testid="global-search"
        />
        {open && (
          <ul
            className="panel absolute left-0 right-0 top-11 z-40 max-h-80 overflow-y-auto p-1"
            data-testid="search-results"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-500">No matches for &ldquo;{q}&rdquo;.</li>
            ) : (
              results.map((r, i) => {
                const Icon = KIND_ICON[r.kind] || MapPin
                return (
                  <li key={`${r.kind}-${r.title}-${i}`}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-primary/5"
                    >
                      <Icon size={15} className="text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{r.title}</span>
                        <span className="data-mono block truncate text-xs text-slate-500">{r.subtitle}</span>
                      </span>
                      {r.kind === 'parcel' && r.verification && (
                        <span
                          className={clsx(
                            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                            r.verification === 'OFFICIAL'
                              ? 'bg-brass/10 text-brass'
                              : 'bg-warn/10 text-warn',
                          )}
                        >
                          {r.verification}
                        </span>
                      )}
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">{r.kind}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      <div className="hidden items-center gap-1 rounded-md border border-slate-200 bg-slate-50 pl-2 pr-1 py-1 text-xs text-slate-600 md:flex">
        <MapPin size={13} className="text-teal" />
        <span className="text-slate-500">
          {selection?.mode === 'coimbatore-demo' ? 'Coimbatore' : 'Chennai'} &middot;
        </span>
        <select
          value={selection?.mode === 'coimbatore-demo' ? 'coimbatore-demo' : area?.id || ''}
          onChange={(e) => {
            const v = e.target.value
            navigate('/map')
            if (v === '__city') cityView?.()
            else if (v === 'coimbatore-demo') selectCoimbatoreDemo?.()
            else if (v.startsWith('region:')) flyToRegion?.(v.slice(7))
            else selectArea(v)
          }}
          className="bg-transparent pr-1 font-semibold text-slate-900 outline-none"
          aria-label="Location"
          data-testid="area-select"
        >
          <option value="__city">Chennai — full coverage</option>
          <optgroup label="Coverage regions">
            {(regions || []).map((r) => (
              <option key={r.id} value={`region:${r.id}`}>{r.name}</option>
            ))}
          </optgroup>
          <optgroup label="Detailed localities">
            {(localities || []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Coimbatore">
            <option value="coimbatore-demo" data-testid="area-option-coimbatore-demo">
              {COIMBATORE_DEMO_PROPERTY.name}
            </option>
          </optgroup>
        </select>
      </div>

      <button
        className="btn-ghost !px-2"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <NotificationBell />

      <div className="flex items-center gap-2 border-l border-slate-200 pl-2">
        <div className="hidden text-right sm:block">
          <div className="text-xs font-semibold text-slate-900">{user?.name}</div>
          <div className="text-[10px] text-slate-500">{user?.role}</div>
        </div>
        <button className="btn-ghost !px-2" onClick={logout} aria-label="Sign out" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
