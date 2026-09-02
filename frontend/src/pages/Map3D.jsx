import { useSearchParams } from 'react-router-dom'
import { useEffect } from 'react'
import {
  RotateCw, RotateCcw, ArrowUpToLine, Home, ZoomIn, ZoomOut, MoveVertical,
} from 'lucide-react'
import { Cesium3DMap } from '../components/map/Cesium3DMap.jsx'
import { LayerManager } from '../components/layout/LayerManager.jsx'
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
  const { mapApi, selection, reset, selectParcel, selectBuilding, selectUnit } = useSelection()
  const [params] = useSearchParams()

  // Deep-link support: /map?unit=... | ?building=... | ?ulpin=...
  useEffect(() => {
    const unit = params.get('unit')
    const building = params.get('building')
    const ulpin = params.get('ulpin')
    if (unit) selectUnit({ propertyId: unit, ulpin: PARCEL_ULPIN })
    else if (building) selectBuilding(building, ulpin || PARCEL_ULPIN)
    else if (ulpin) selectParcel(ulpin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const m = () => mapApi.current

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Cesium3DMap />
      <LayerManager />
      <PropertySidebar />
      <ExplorerDock />

      {/* Camera + view-level controls (spec section 30) — top-centre strip */}
      <div className="pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl panel p-1.5">
        <CamButton onClick={() => m().zoomBy?.(-0.25)} title="Zoom in"><ZoomIn size={15} /></CamButton>
        <CamButton onClick={() => m().zoomBy?.(0.4)} title="Zoom out"><ZoomOut size={15} /></CamButton>
        <CamButton onClick={() => m().rotateBy?.(-20)} title="Rotate left"><RotateCcw size={15} /></CamButton>
        <CamButton onClick={() => m().rotateBy?.(20)} title="Rotate right"><RotateCw size={15} /></CamButton>
        <CamButton onClick={() => m().tiltBy?.(8)} title="Tilt"><MoveVertical size={15} /></CamButton>
        <CamButton onClick={() => m().topView?.()} title="Top view"><ArrowUpToLine size={15} /></CamButton>
        <CamButton onClick={reset} title="Reset view"><Home size={15} /></CamButton>
        <div className="mx-1 h-5 w-px bg-white/15" />
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
  )
}
