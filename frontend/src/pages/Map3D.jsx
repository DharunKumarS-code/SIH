import { useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  RotateCw, RotateCcw, ArrowUpToLine, Home, ZoomIn, ZoomOut, MoveVertical,
} from 'lucide-react'
import { Cesium3DMap } from '../components/map/Cesium3DMap.jsx'
import { LayerManager } from '../components/layout/LayerManager.jsx'
import { AreaSelector } from '../components/layout/AreaSelector.jsx'
import { PropertySidebar } from '../components/layout/PropertySidebar.jsx'
import { ExplorerDock } from '../components/layout/ExplorerDock.jsx'
import { useSelection } from '../context/SelectionContext.jsx'
import { PARCEL_ULPIN } from '../lib/constants.js'

function CamButton({ onClick, title, children }) {
  return (
    <button className="btn-ghost !px-2 !py-2" onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  )
}

export default function Map3D() {
  const { mapApi, selection, reset, selectParcel, selectBuilding, selectUnit, selectArea } = useSelection()
  const [params] = useSearchParams()

  // Deep-link support: /map?area=... | ?unit=... | ?building=... | ?ulpin=...
  useEffect(() => {
    const areaId = params.get('area')
    const unit = params.get('unit')
    const building = params.get('building')
    const ulpin = params.get('ulpin')
    // The parcel ULPIN, building id and floor number are all encoded in a
    // property id (e.g. TN-CHN-323456789-B03-F02-U201). Derive them so a deep
    // link resolves to the exact entity — and never falls back to a hard-coded
    // (Sholinganallur) parcel for an entity in another locality.
    const ulpinFrom = (id) => (id && /^(TN-CHN-\d+)/.exec(id)?.[1]) || null
    const buildingFrom = (id) => (id && /^(TN-CHN-\d+-B\d+)/.exec(id)?.[1]) || null
    const floorFrom = (id) => {
      const m = id && /-F(\d+)/.exec(id)
      return m ? Number(m[1]) : null
    }
    if (areaId) selectArea(areaId)
    if (unit) {
      selectUnit({
        propertyId: unit,
        ulpin: ulpin || ulpinFrom(unit) || PARCEL_ULPIN,
        buildingId: buildingFrom(unit),
        floorNumber: floorFrom(unit),
      })
    } else if (building) selectBuilding(building, ulpin || ulpinFrom(building) || PARCEL_ULPIN)
    else if (ulpin) selectParcel(ulpin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const m = () => mapApi.current
  // Status slot (building / TNGIS coverage) — Cesium3DMap portals its live
  // counters into it so they sit in the overlay grid instead of under the dock.
  const [statusSlot, setStatusSlot] = useState(null)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Cesium3DMap statusSlot={statusSlot} />

      {/* Overlay grid (see .map-overlay-grid in index.css): every floating panel
          gets its own grid area, so panels shrink + scroll instead of
          overlapping at any viewport size. No z-index here on purpose — the
          sidebar's fixed-position dialogs must still stack above the TopBar. */}
      <div className="map-overlay-grid pointer-events-none absolute inset-0" data-testid="map-overlay">
        <div className="flex min-h-0 flex-col items-start [grid-area:left]">
          <LayerManager />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-2 [grid-area:right] md:w-72 xl:w-80">
          <PropertySidebar />
          <AreaSelector />
        </div>
        <div ref={setStatusSlot} className="flex min-w-0 flex-col items-center justify-end gap-2 [grid-area:status]" />
        <div className="min-w-0 [grid-area:dock]">
          <ExplorerDock />
        </div>

        {/* Camera + view-level controls (spec section 30) — top-centre strip */}
        <div className="flex min-w-0 justify-center [grid-area:tool]">
          <div className="panel pointer-events-auto flex flex-wrap items-center justify-center gap-1 p-1.5">
            <CamButton onClick={() => m().zoomBy?.(-0.25)} title="Zoom in"><ZoomIn size={15} /></CamButton>
            <CamButton onClick={() => m().zoomBy?.(0.4)} title="Zoom out"><ZoomOut size={15} /></CamButton>
            <CamButton onClick={() => m().rotateBy?.(-20)} title="Rotate left"><RotateCcw size={15} /></CamButton>
            <CamButton onClick={() => m().rotateBy?.(20)} title="Rotate right"><RotateCw size={15} /></CamButton>
            <CamButton onClick={() => m().tiltBy?.(8)} title="Tilt"><MoveVertical size={15} /></CamButton>
            <CamButton onClick={() => m().topView?.()} title="Top view"><ArrowUpToLine size={15} /></CamButton>
            <CamButton onClick={reset} title="Reset view"><Home size={15} /></CamButton>
            <div className="mx-1 h-5 w-px bg-slate-200" />
            <button
              className="btn-primary !py-1.5"
              data-testid="focus-selected"
              onClick={() => {
                if (selection.mode === 'unit') m().flyToUnit?.(selection.propertyId)
                else if (selection.buildingId) m().flyToBuilding?.(selection.buildingId)
                else m().flyToParcel?.(selection.ulpin)
              }}
            >
              Focus Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
