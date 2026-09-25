import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronRight, Box } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageHeader, PageScroll, Badge, Spinner, Card } from '../components/ui/primitives.jsx'
import { PARCEL_ULPIN, LOCALITIES_FALLBACK } from '../lib/constants.js'

// Deep link into the standalone detailed 3D Building Explorer (new tab).
function explorerUrl({ ulpin, buildingSeg, floorSeg, unitId }) {
  const loc = LOCALITIES_FALLBACK.find((l) => l.ulpinPrimary === ulpin)
  const q = new URLSearchParams({ ulpin })
  if (loc) q.set('area', loc.id)
  if (buildingSeg) q.set('buildingId', buildingSeg)
  if (floorSeg) q.set('floorId', floorSeg)
  if (unitId) q.set('unitId', unitId)
  return `/3d-explorer?${q.toString()}`
}

// A pure tree view of Parcel -> Building -> Floor -> Unit (spec section 7).
export default function FloorUnitExplorer() {
  const navigate = useNavigate()
  const [buildings, setBuildings] = useState([])
  const [openB, setOpenB] = useState({})
  const [floors, setFloors] = useState({}) // buildingId -> floors[]
  const [openF, setOpenF] = useState({})
  const [units, setUnits] = useState({}) // floorId -> units[]

  useEffect(() => {
    api.parcel(PARCEL_ULPIN).then((d) => setBuildings(d.buildings || [])).catch(() => {})
  }, [])

  const toggleBuilding = async (b) => {
    setOpenB((s) => ({ ...s, [b.buildingId]: !s[b.buildingId] }))
    if (!floors[b.buildingId]) {
      const f = await api.buildingFloors(b.buildingId).catch(() => [])
      setFloors((s) => ({ ...s, [b.buildingId]: f }))
    }
  }
  const toggleFloor = async (f) => {
    setOpenF((s) => ({ ...s, [f.floorId]: !s[f.floorId] }))
    if (!units[f.floorId]) {
      const d = await api.floor(f.floorId).catch(() => ({ units: [] }))
      setUnits((s) => ({ ...s, [f.floorId]: d.units }))
    }
  }

  return (
    <PageScroll>
      <PageHeader
        title="Floor & Unit Explorer"
        subtitle={`Every apartment on ${PARCEL_ULPIN} is an independently identified entity`}
      />
      <Card>
        <div className="flex items-center gap-2 text-sm">
          <Badge>PARCEL</Badge>
          <span className="font-mono text-slate-900">{PARCEL_ULPIN}</span>
        </div>
        <ul className="mt-2 space-y-1">
          {!buildings.length && <Spinner />}
          {buildings.map((b) => (
            <li key={b.buildingId}>
              <button
                onClick={() => toggleBuilding(b)}
                className="flex w-full items-center gap-2 rounded bg-slate-50 px-2 py-1.5 text-left text-sm hover:bg-slate-200"
              >
                <ChevronRight size={14} className={clsx('transition-transform', openB[b.buildingId] && 'rotate-90')} />
                <Badge>{b.buildingSegment}</Badge>
                <span className="font-semibold text-slate-900">{b.shortName}</span>
                <span className="ml-auto text-xs text-slate-500">{b.totalFloors} floors · {b.unitCount} units</span>
              </button>
              {openB[b.buildingId] && (
                <div className="ml-6 mt-1">
                  <a
                    href={explorerUrl({ ulpin: PARCEL_ULPIN, buildingSeg: b.buildingSegment })}
                    target="_blank"
                    data-testid={`explorer-link-${b.buildingSegment}`}
                    className="mb-1 inline-flex items-center gap-1.5 rounded border border-slate-300 bg-surface px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Box size={11} className="text-primary" /> Open 3D Building Explorer
                  </a>
                </div>
              )}
              {openB[b.buildingId] && (
                <ul className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-3">
                  {(floors[b.buildingId] || []).slice().reverse().map((f) => (
                    <li key={f.floorId}>
                      <button
                        onClick={() => toggleFloor(f)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-slate-100"
                      >
                        <ChevronRight size={12} className={clsx('transition-transform', openF[f.floorId] && 'rotate-90')} />
                        <span className="text-slate-700">{f.label}</span>
                        <span className="ml-auto text-[11px] text-slate-500">{f.floorSegment} · {f.unitCount}u</span>
                      </button>
                      {openF[f.floorId] && (
                        <ul className="ml-5 mt-0.5 grid grid-cols-2 gap-1 border-l border-slate-200 pl-3 sm:grid-cols-3">
                          {(units[f.floorId] || []).map((u) => (
                            <li key={u.propertyId}>
                              <button
                                onClick={() => navigate(`/map?unit=${encodeURIComponent(u.propertyId)}`)}
                                className="flex w-full items-center gap-1 rounded bg-slate-50 px-1.5 py-1 text-left text-[11px] hover:bg-primary/15"
                                title={u.propertyId}
                              >
                                <Box size={10} className="text-primary" />
                                <span className="font-mono text-slate-900">{u.unitId}</span>
                                <span className="ml-auto text-slate-500">{u.bedrooms || u.usage}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </PageScroll>
  )
}
