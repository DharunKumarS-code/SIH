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
  // Each fetch result is stored with the key it was requested for and only
  // shown while that key is still current — so a slow response for a
  // previously selected parcel/building/floor can never overwrite (or be
  // displayed for) the current selection.
  const floorKey =
    selection.buildingId && selection.floorNumber != null
      ? `${selection.buildingId}-F${String(selection.floorNumber).padStart(2, '0')}`
      : null
  const [buildingsRes, setBuildingsRes] = useState({ key: null, data: [] })
  const [floorsRes, setFloorsRes] = useState({ key: null, data: [] })
  const [unitsRes, setUnitsRes] = useState({ key: null, data: [] })
  const buildings = areaUlpin && buildingsRes.key === areaUlpin ? buildingsRes.data : []
  const floors = selection.buildingId && floorsRes.key === selection.buildingId ? floorsRes.data : []
  const floorUnits = floorKey && unitsRes.key === floorKey ? unitsRes.data : []
  const [collapsed, setCollapsed] = useState(false)

  // Coimbatore's demonstration property has no building/floor/unit hierarchy
  // of its own — this dock always shows the *Chennai* area's blocks (by
  // design, independent of the 3D scene selection, see below), so it must
  // stay hidden while Coimbatore is selected or a Chennai building would
  // visibly appear alongside the one Coimbatore property.
  const hidden = selection.mode === 'coimbatore-demo'

  useEffect(() => {
    if (!areaUlpin) return
    api.parcel(areaUlpin)
      .then((d) => setBuildingsRes({ key: areaUlpin, data: d.buildings || [] }))
      .catch(() => setBuildingsRes({ key: areaUlpin, data: [] }))
  }, [areaUlpin])

  useEffect(() => {
    const buildingId = selection.buildingId
    if (!buildingId) return
    api.buildingFloors(buildingId)
      .then((data) => setFloorsRes({ key: buildingId, data: data || [] }))
      .catch(() => setFloorsRes({ key: buildingId, data: [] }))
  }, [selection.buildingId])

  useEffect(() => {
    if (!floorKey) return
    api.floor(floorKey)
      .then((d) => setUnitsRes({ key: floorKey, data: d.units || [] }))
      .catch(() => setUnitsRes({ key: floorKey, data: [] }))
  }, [floorKey])

  if (hidden) return null

  return (
    <div
      className={clsx(
        'panel pointer-events-auto absolute bottom-3 left-3 z-10 p-3 transition-all',
        // Shrink away from the right-hand detail sidebar whenever one is shown
        // (building/floor now render the full BuildingCard, not a stub) so the
        // dock — and its floor plan — never sits underneath and swallows clicks.
        ['building', 'floor', 'unit', 'parcel', 'ai-building', 'ai-floor-unit', 'infrastructure', 'gnss-point'].includes(selection.mode)
          ? 'right-3 xl:right-[21.5rem]'
          : 'right-3',
        collapsed ? 'max-h-12 overflow-hidden' : 'max-h-[46vh]',
      )}
      data-testid="explorer-dock"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="section-title flex items-center gap-2">
          <Layers3 size={13} /> Floor &amp; Unit Explorer — <span className="data-mono normal-case">{areaUlpin}</span>
        </span>
        <button className="btn-ghost !px-1.5 !py-1" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle explorer">
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_260px]">
          {/* Building blocks */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-500">Building Blocks</p>
            <div className="flex flex-wrap gap-1.5">
              {buildings.map((b) => (
                <button
                  key={b.buildingId}
                  onClick={() => selectBuilding(b.buildingId, areaUlpin)}
                  className={clsx(
                    'rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors',
                    selection.buildingId === b.buildingId
                      ? 'border-primary bg-primary/10 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-200',
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
            <p className="mb-1 text-[11px] font-semibold text-slate-500">
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
                      ? 'bg-primary/15 text-slate-900'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-200',
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
            <p className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
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
