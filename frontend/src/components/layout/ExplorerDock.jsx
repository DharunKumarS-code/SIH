import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Building2, Layers3, ChevronUp, ChevronDown } from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'
import { api } from '../../lib/api.js'
import { FloorPlan } from '../map/FloorPlan.jsx'
import { Badge } from '../ui/primitives.jsx'

// Bottom dock: Building Blocks (section 10) + Floors (section 11) + Floor Plan (section 12)
export function ExplorerDock() {
  const { selection, area, selectBuilding, selectFloor, selectUnit } = useSelection()
  const areaUlpin = area?.ulpin
  const [buildings, setBuildings] = useState([])
  const [floors, setFloors] = useState([])
  const [floorUnits, setFloorUnits] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!areaUlpin) return
    setBuildings([])
    api.parcel(areaUlpin).then((d) => setBuildings(d.buildings || [])).catch(() => {})
  }, [areaUlpin])

  useEffect(() => {
    if (!selection.buildingId) {
      setFloors([])
      return
    }
    api.buildingFloors(selection.buildingId).then(setFloors).catch(() => setFloors([]))
  }, [selection.buildingId])

  useEffect(() => {
    if (!selection.buildingId || selection.floorNumber == null) {
      setFloorUnits([])
      return
    }
    const floorId = `${selection.buildingId}-F${String(selection.floorNumber).padStart(2, '0')}`
    api.floor(floorId).then((d) => setFloorUnits(d.units || [])).catch(() => setFloorUnits([]))
  }, [selection.buildingId, selection.floorNumber])

  return (
    <div
      className={clsx(
        'pointer-events-auto absolute bottom-3 left-3 z-10 rounded-xl panel p-3 transition-all',
        ['unit', 'parcel', 'ai-building'].includes(selection.mode) ? 'right-3 xl:right-[21.5rem]' : 'right-3',
        collapsed ? 'max-h-12 overflow-hidden' : 'max-h-[46vh]',
      )}
      data-testid="explorer-dock"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="section-title flex items-center gap-2">
          <Layers3 size={13} /> Floor &amp; Unit Explorer — {areaUlpin}
        </span>
        <button className="btn-ghost !px-1.5 !py-1" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle explorer">
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_260px]">
          {/* Building blocks */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-400">Building Blocks</p>
            <div className="flex flex-wrap gap-1.5">
              {buildings.map((b) => (
                <button
                  key={b.buildingId}
                  onClick={() => selectBuilding(b.buildingId, areaUlpin)}
                  className={clsx(
                    'rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors',
                    selection.buildingId === b.buildingId
                      ? 'border-primary bg-primary/20 text-white'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
                  )}
                  data-testid={`building-block-${b.buildingSegment}`}
                >
                  <span className="flex items-center gap-1 font-bold">
                    <Building2 size={11} /> {b.buildingSegment}
                  </span>
                  <span className="block truncate">{b.shortName}</span>
                  <span className="text-slate-500">{b.unitCount} units</span>
                </button>
              ))}
            </div>
          </div>

          {/* Floors */}
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold text-slate-400">
              Floors {selection.buildingId ? `— ${selection.buildingId.split('-').pop()}` : ''}
            </p>
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
              {floors.length === 0 && <span className="text-[11px] text-slate-500">Select a building.</span>}
              {[...floors].reverse().map((f) => (
                <button
                  key={f.floorId}
                  onClick={() => selectFloor(selection.buildingId, f.floorNumber, areaUlpin)}
                  className={clsx(
                    'rounded px-2 py-1 text-left text-[11px]',
                    selection.floorNumber === f.floorNumber
                      ? 'bg-primary/25 text-white'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10',
                  )}
                  data-testid={`floor-row-${f.floorSegment}`}
                >
                  {f.label} · {f.unitCount}u
                </button>
              ))}
            </div>
          </div>

          {/* Floor plan */}
          <div className="min-w-0">
            <p className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-400">
              Floor Plan
              {floorUnits.length > 0 && <Badge>{floorUnits.length} units</Badge>}
            </p>
            <FloorPlan
              units={floorUnits}
              selectedPropertyId={selection.propertyId}
              onSelectUnit={(u) =>
                selectUnit({
                  propertyId: u.propertyId,
                  buildingId: selection.buildingId,
                  floorNumber: selection.floorNumber,
                  ulpin: areaUlpin,
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
