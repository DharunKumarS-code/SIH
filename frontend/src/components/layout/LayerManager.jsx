import { useState } from 'react'
import clsx from 'clsx'
import { Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'
import { DemoTag } from '../ui/primitives.jsx'

const GROUPS = [
  {
    title: 'Base Layers',
    rows: [
      ['parcels', 'Cadastral Parcels'],
      ['ulpinBoundaries', 'ULPIN Boundaries'],
      ['buildings', 'Buildings 3D'],
      ['roads', 'Roads'],
      ['imagery', 'Satellite / Imagery'],
      ['terrain', 'Terrain'],
    ],
  },
  {
    title: 'Governance Layers',
    rows: [
      ['recordOfRights', 'Record of Rights (RoR)'],
      ['registration', 'Registration Records'],
      ['buildingPermissions', 'Building Permissions'],
      ['landUse', 'Land Use / Zoning'],
      ['encumbrances', 'Encumbrances'],
      ['propertyTax', 'Property Tax'],
      ['disputes', 'Court / Dispute Records'],
      ['masterPlan', 'Master Plan'],
    ],
  },
  {
    title: 'Utility & Infrastructure',
    demo: true,
    rows: [
      ['waterSupply', 'Water Supply'],
      ['sewerLines', 'Sewer Lines'],
      ['electricity', 'Electricity'],
      ['drainage', 'Drainage'],
      ['gasPipeline', 'Gas Pipeline'],
      ['fiberNetwork', 'Fiber Network'],
    ],
  },
  {
    title: 'Environment & Restrictions',
    demo: true,
    rows: [
      ['waterBodies', 'Water Bodies'],
      ['ecoZones', 'Eco Sensitive Zones'],
      ['heritageZones', 'Heritage Zones'],
      ['coastalZone', 'Coastal Regulation Zone'],
    ],
  },
  {
    title: 'Administrative Boundaries',
    rows: [
      ['corporationBoundary', 'Corporation Boundary'],
      ['zoneBoundary', 'Zone Boundary'],
      ['wardBoundary', 'Ward Boundary'],
    ],
  },
  {
    title: '3D Property',
    rows: [
      ['bldg3d', 'Buildings'],
      ['floors3d', 'Floors'],
      ['units3d', 'Apartment Units'],
      ['commonAreas', 'Common Areas'],
      ['parking', 'Parking'],
    ],
  },
  {
    title: 'AI Extraction',
    demo: true,
    rows: [
      ['aiBuildings', 'AI-Derived Buildings'],
      ['aiFloorUnits', 'AI Floor Plans / Property Units'],
    ],
  },
  {
    title: 'Elevation / LiDAR',
    demo: true,
    rows: [
      ['elevationHeightQuality', 'Height Quality (accepted buildings)'],
    ],
  },
  {
    title: 'GNSS / CORS Control',
    demo: true,
    rows: [
      ['gnssControlPoints', 'GNSS/CORS Control Points'],
    ],
  },
  {
    title: 'Underground Infrastructure',
    demo: true,
    rows: [
      ['undergroundInfrastructure', 'Underground Infrastructure'],
    ],
  },
]

export function LayerManager() {
  const { layers, toggleLayer } = useSelection()
  const [open, setOpen] = useState(true)

  return (
    <div
      className={clsx(
        'pointer-events-auto absolute left-3 top-3 z-10 rounded-xl panel transition-all',
        open ? 'w-64' : 'w-11',
      )}
      data-testid="layer-manager"
    >
      <div className="flex items-center justify-between px-3 py-2">
        {open && (
          <span className="section-title flex items-center gap-2">
            <Layers size={13} /> GIS Layers
          </span>
        )}
        <button className="btn-ghost !px-1.5 !py-1" onClick={() => setOpen((v) => !v)} aria-label="Toggle layer panel">
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {open && (
        <div className="max-h-[62vh] space-y-3 overflow-y-auto px-3 pb-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {g.title} {g.demo && <DemoTag label="DEMO" />}
              </p>
              <div className="space-y-0.5">
                {g.rows.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-slate-300 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(layers[key])}
                      onChange={() => toggleLayer(key)}
                      className="accent-primary"
                      data-testid={`layer-${key}`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
