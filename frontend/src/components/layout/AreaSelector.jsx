import { useState } from 'react'
import clsx from 'clsx'
import { MapPin, ChevronRight, ChevronLeft, Building2, Layers, Home } from 'lucide-react'
import { useSelection } from '../../context/SelectionContext.jsx'

// ONE Chennai-wide Cesium environment. This panel is the area selector +
// area information panel: it never swaps maps — it flies the SAME camera
// between localities and shows the active locality's context.
export function AreaSelector() {
  const { localities, area, selectArea, cityView, selection } = useSelection()
  const [open, setOpen] = useState(true)

  const active = (localities || []).find((l) => l.id === area?.id)

  return (
    <div
      className={clsx(
        'pointer-events-auto absolute top-3 z-10 rounded-xl panel transition-all',
        ['unit', 'parcel', 'ai-building', 'ai-floor-unit'].includes(selection.mode) ? 'right-3 xl:right-[21.5rem]' : 'right-3',
        open ? 'w-64' : 'w-11',
      )}
      data-testid="area-selector"
    >
      <div className="flex items-center justify-between px-3 py-2">
        {open && (
          <span className="section-title flex items-center gap-2">
            <MapPin size={13} /> Chennai Areas
          </span>
        )}
        <button
          className="btn-ghost !px-1.5 !py-1"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle area panel"
        >
          {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <button
            onClick={cityView}
            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-200"
            data-testid="area-city-overview"
          >
            <Home size={13} /> Chennai overview
          </button>

          <div className="space-y-1">
            {(localities || []).map((l) => {
              const on = l.id === area?.id
              return (
                <button
                  key={l.id}
                  onClick={() => selectArea(l.id)}
                  className={clsx(
                    'w-full rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-200',
                  )}
                  data-testid={`area-option-${l.id}`}
                >
                  <span className="flex items-center justify-between font-semibold">
                    {l.name}
                    {on && <span className="text-[10px] uppercase text-primary">active</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Layers size={10} /> {l.counts?.parcels ?? '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Building2 size={10} /> {l.counts?.buildings ?? '—'}
                    </span>
                    <span>{l.counts?.units ?? '—'} units</span>
                  </span>
                </button>
              )
            })}
          </div>

          {active && (
            <div className="rounded-md border border-slate-200 bg-[#f5f7fa]/40 p-2 text-[11px] text-slate-600">
              <p className="font-semibold text-slate-900">{active.label || active.name}</p>
              {active.zone && <p className="text-slate-500">{active.zone}</p>}
              <p className="mt-1 font-mono text-[10px] text-cyan">{active.ulpinPrimary}</p>
              <p className="mt-1 text-slate-500">
                {selection.mode === 'overview'
                  ? 'Select a building to drill into floors and units.'
                  : `Viewing: ${selection.mode}`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
