import { useEffect, useRef } from 'react'
import { drawBoundary } from '../../lib/boundaryMap.js'

// On-screen render of the certificate's boundary/footprint outline. Purely a
// plain geometry plot (no basemap/satellite imagery, no Cesium) — see
// lib/boundaryMap.js for the shared drawing logic also used by the PDF export.
export function CertificateBoundaryMap({ boundary, width = 320, height = 200 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    drawBoundary(ctx, boundary?.ring || null, { width, height })
  }, [boundary, width, height])

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <canvas ref={ref} width={width} height={height} className="block w-full" />
      <p className="border-t border-slate-100 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
        {boundary?.label || 'Boundary — Not Available'}
      </p>
    </div>
  )
}
