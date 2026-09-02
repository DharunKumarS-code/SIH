import { useMemo } from 'react'
import clsx from 'clsx'

// Simplified interactive floor plan (spec section 12). Units are placed on a
// grid from their gridCol/gridRow (falls back to sequential layout). A central
// "STAIR / LIFT" strip separates the two halves. Every unit is clickable.
export function FloorPlan({ units = [], selectedPropertyId, onSelectUnit }) {
  const layout = useMemo(() => {
    if (!units.length) return { cells: [], cols: 0, rows: 0 }
    const hasGrid = units.every((u) => u.gridCol != null && u.gridRow != null)
    let cols
    let rows
    let place
    if (hasGrid) {
      cols = Math.max(...units.map((u) => u.gridCol)) + 1
      rows = Math.max(...units.map((u) => u.gridRow)) + 1
      place = (u) => ({ c: u.gridCol, r: u.gridRow })
    } else {
      cols = Math.min(4, units.length)
      rows = Math.ceil(units.length / cols)
      place = (u, i) => ({ c: i % cols, r: Math.floor(i / cols) })
    }
    const cells = units.map((u, i) => ({ ...u, ...place(u, i) }))
    return { cells, cols, rows }
  }, [units])

  if (!units.length) {
    return <p className="py-6 text-center text-xs text-slate-500">Select a floor to see its layout.</p>
  }

  const { cells, cols, rows } = layout
  const W = 260
  const H = Math.max(120, rows * 62 + 30)
  const cw = W / cols
  const ch = (H - 26) / rows

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Floor plan">
      <rect x="0" y="0" width={W} height={H} rx="6" className="fill-navy-950 stroke-white/10" />
      {/* central circulation strip */}
      <rect x={W / 2 - 14} y="10" width="28" height={H - 20} className="fill-white/5" />
      <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-slate-500 text-[7px]" transform={`rotate(-90 ${W / 2} ${H / 2})`}>
        STAIR · LIFT
      </text>
      {cells.map((u) => {
        const x = u.c * cw + (u.c >= cols / 2 ? 6 : 0) + 3
        const y = u.r * ch + 16
        const selected = u.propertyId === selectedPropertyId
        return (
          <g
            key={u.propertyId}
            onClick={() => onSelectUnit(u)}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelectUnit(u)}
            data-testid={`floorplan-unit-${u.unitId}`}
          >
            <rect
              x={x}
              y={y}
              width={cw - 8}
              height={ch - 8}
              rx="3"
              className={clsx(
                'transition-colors',
                selected
                  ? 'fill-gold/80 stroke-gold'
                  : u.usage === 'Commercial'
                    ? 'fill-warn/25 stroke-warn/50 hover:fill-warn/40'
                    : 'fill-primary/20 stroke-primary/40 hover:fill-primary/35',
              )}
            />
            <text x={x + (cw - 8) / 2} y={y + (ch - 8) / 2 + 3} textAnchor="middle" className={clsx('text-[8px] font-bold', selected ? 'fill-navy-950' : 'fill-slate-100')}>
              {u.unitId}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
