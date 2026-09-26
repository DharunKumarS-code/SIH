// Draws the Smart Property Card's "3D Property Visualization" panel — a
// schematic isometric massing of ULPIN → Parcel → Building → Floor → Unit →
// 3D Volume, built only from the numeric fields already on the card's own
// `data.threeD` (totalFloors/floorNumber/buildingHeightM/bounds). It is a
// proportion-driven technical diagram, not a photorealistic render and not a
// stand-in for the Cesium 3D map — with no floor/height data it draws an
// explicit "Not Available" placeholder rather than inventing a shape.
// Shared by the on-screen preview (components/certificate/PropertyVolumeGlyph.jsx)
// and the PDF writer (lib/certificatePdf.js) so both render the identical image.

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)

function iso(ox, oy, scale, x, y, z) {
  return [ox + (x - y) * COS30 * scale, oy + (x + y) * SIN30 * scale - z * scale]
}

function fillPoly(ctx, pts, fill, stroke) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

/** One rectangular prism (w × d × h) with its base at local (baseX, baseY,
 * baseZ), drawn as three visible faces (top / right / front) for a simple
 * cube-stack look. */
function drawBox(ctx, ox, oy, scale, baseX, baseY, w, d, baseZ, h, { top, right, front, stroke }) {
  const P = (x, y, z) => iso(ox, oy, scale, baseX + x, baseY + y, z)
  const p000 = P(0, 0, baseZ)
  const p100 = P(w, 0, baseZ)
  const p010 = P(0, d, baseZ)
  const p110 = P(w, d, baseZ)
  const p001 = P(0, 0, baseZ + h)
  const p101 = P(w, 0, baseZ + h)
  const p011 = P(0, d, baseZ + h)
  const p111 = P(w, d, baseZ + h)

  fillPoly(ctx, [p001, p101, p111, p011], top, stroke) // top face
  fillPoly(ctx, [p100, p110, p111, p101], right, stroke) // right face
  fillPoly(ctx, [p010, p110, p111, p011], front, stroke) // front face
  return { p000, p100, p010, p110, p001, p101, p011, p111 }
}

function drawAxisGlyph(ctx, x, y, scale) {
  const P = (dx, dy, dz) => iso(x, y, scale, dx, dy, dz)
  const origin = P(0, 0, 0)
  const axes = [
    { to: P(1, 0, 0), label: 'X', color: '#b45309' },
    { to: P(0, 1, 0), label: 'Y', color: '#0f766e' },
    { to: P(0, 0, 1), label: 'Z', color: '#144382' },
  ]
  axes.forEach(({ to, label, color }) => {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(...origin)
    ctx.lineTo(...to)
    ctx.stroke()
    ctx.font = 'bold 10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, to[0] + (label === 'Z' ? 0 : 6) * (to[0] > origin[0] ? 1 : -1), to[1] + (label === 'Z' ? -4 : 3))
  })
}

function placeholder(ctx, width, height, text) {
  ctx.fillStyle = '#64748b'
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, height / 2)
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} glyph  { kind, totalFloors, floorNumber, hasUnit, buildingCount }
 */
export function drawVolumeGlyph(ctx, glyph, { width, height, padding = 18 }) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  const { kind, totalFloors, floorNumber, hasUnit, buildingCount } = glyph

  if (kind === 'parcel') {
    const n = Number.isFinite(buildingCount) ? Math.max(0, Math.min(buildingCount, 6)) : 0
    const ox = width * 0.28
    const oy = height * 0.72
    const scale = Math.min(width, height) * 0.155
    // Parcel ground plane.
    fillPoly(
      ctx,
      [iso(ox, oy, scale, 0, 0, 0), iso(ox, oy, scale, 3.4, 0, 0), iso(ox, oy, scale, 3.4, 3.4, 0), iso(ox, oy, scale, 0, 3.4, 0)],
      'rgba(20,67,130,0.10)',
      '#144382',
    )
    if (n === 0) {
      placeholder(ctx, width, height, 'No 3D volume linked to this parcel record')
      return
    }
    for (let i = 0; i < n; i += 1) {
      const bx = 0.3 + (i % 3) * 1.15
      const by = 0.3 + Math.floor(i / 3) * 1.6
      drawBox(ctx, ox, oy, scale, bx, by, 0.8, 0.8, 0, 1 + (i % 3) * 0.35, {
        top: 'rgba(15,118,110,0.35)',
        right: 'rgba(15,118,110,0.22)',
        front: 'rgba(15,118,110,0.28)',
        stroke: '#0f766e',
      })
    }
    drawAxisGlyph(ctx, width * 0.08, height * 0.9, scale * 0.6)
    return
  }

  const floors = Number.isFinite(totalFloors) && totalFloors > 0 ? Math.min(Math.round(totalFloors), 24) : null
  if (!floors) {
    placeholder(ctx, width, height, 'Floor count not available for this building')
    return
  }

  const ox = width * 0.3
  const oy = height * 0.88
  const footprint = 2.2
  const floorH = Math.max(0.55, Math.min(1.1, 9 / floors))
  const scale = Math.min(
    (width - padding * 2) / ((footprint * 2) * COS30 || 1),
    (height - padding * 2) / (footprint * SIN30 + floors * floorH || 1),
  ) * 0.92

  const selected = kind === 'unit' && Number.isFinite(floorNumber) ? Math.max(1, Math.min(floorNumber, floors)) : null

  for (let i = 0; i < floors; i += 1) {
    const isSelected = selected != null && i + 1 === selected
    const tone = isSelected
      ? { top: '#5eead4', right: '#0f766e', front: '#0d9488', stroke: '#0f766e' }
      : { top: '#e2e8f0', right: '#cbd5e1', front: '#dbe3ec', stroke: '#94a3b8' }
    drawBox(ctx, ox, oy, scale, 0, 0, footprint, footprint, i * floorH, floorH, tone)
  }

  if (selected != null && hasUnit) {
    // Small inset "unit" marker sitting on the highlighted floor slab.
    const baseZ = (selected - 1) * floorH + floorH
    drawBox(ctx, ox, oy, scale, footprint * 0.3, footprint * 0.3, footprint * 0.4, footprint * 0.4, baseZ, floorH * 0.3, {
      top: '#fde68a',
      right: '#b45309',
      front: '#d97706',
      stroke: '#92400e',
    })
  }

  drawAxisGlyph(ctx, width * 0.06, height * 0.94, scale * 0.7)
}

/** Renders the glyph to an offscreen canvas and returns a PNG data URL. */
export function volumeGlyphToDataUrl(glyph, opts) {
  const canvas = document.createElement('canvas')
  canvas.width = opts.width
  canvas.height = opts.height
  const ctx = canvas.getContext('2d')
  drawVolumeGlyph(ctx, glyph, opts)
  return canvas.toDataURL('image/png')
}

/** Builds the glyph input from a CertificateData object (see lib/certificate.js). */
export function volumeGlyphOf(data) {
  const t = data.threeD || {}
  return {
    kind: data.kind,
    totalFloors: Number.isFinite(t.totalFloors) ? t.totalFloors : null,
    floorNumber: Number.isFinite(t.floorNumber) ? t.floorNumber : null,
    hasUnit: data.kind === 'unit',
    buildingCount: t.buildingCount,
  }
}
