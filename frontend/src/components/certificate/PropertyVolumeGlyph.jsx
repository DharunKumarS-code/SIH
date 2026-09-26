import { useEffect, useRef } from 'react'
import { drawVolumeGlyph } from '../../lib/volumeGlyph.js'

// On-screen render of the Smart Property Card's 3D visualization panel — see
// lib/volumeGlyph.js for the shared drawing logic also used by the PDF export.
export function PropertyVolumeGlyph({ glyph, width = 420, height = 300, className }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    drawVolumeGlyph(ctx, glyph, { width, height })
  }, [glyph, width, height])

  return <canvas ref={ref} width={width} height={height} className={className} />
}
