// Draws a small parcel/building/unit boundary polygon onto a canvas — a plain
// geometry outline (not a satellite/basemap image), with a north arrow and a
// metric scale bar, using ONLY the ring already present in the record's own
// GeoJSON geometry. Never invents coordinates: with no ring it draws an
// explicit "Not Available" placeholder. Shared by the certificate's on-screen
// preview (components/certificate/CertificateBoundaryMap.jsx) and the PDF
// writer (lib/certificatePdf.js) so both render the identical image.

const M_PER_DEG_LAT = 111320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

const NICE_METRE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]

export function drawBoundary(ctx, ring, { width, height, padding = 28 }) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  if (!Array.isArray(ring) || ring.length < 4) {
    ctx.fillStyle = '#64748b'
    ctx.font = '13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Not Available', width / 2, height / 2)
    return
  }

  const lats = ring.map((c) => c[1])
  const lons = ring.map((c) => c[0])
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2
  const mLon = mPerDegLon(latMid)
  // Local equirectangular projection (metres) — accurate enough at parcel scale.
  const pts = ring.map(([lon, lat]) => [(lon - lons[0]) * mLon, (lat - lats[0]) * M_PER_DEG_LAT])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const drawW = width - padding * 2
  const drawH = height - padding * 2 - 20 // reserve room for the scale-bar caption
  const scale = Math.min(drawW / spanX, drawH / spanY)

  const toPx = ([x, y]) => [
    padding + (x - minX) * scale,
    padding + drawH - (y - minY) * scale, // flip Y so north is up
  ]

  ctx.strokeStyle = '#144382'
  ctx.fillStyle = 'rgba(20, 67, 130, 0.12)'
  ctx.lineWidth = 1.75
  ctx.beginPath()
  pts.forEach((p, i) => {
    const [px, py] = toPx(p)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#144382'
  pts.forEach((p) => {
    const [px, py] = toPx(p)
    ctx.beginPath()
    ctx.arc(px, py, 2.2, 0, Math.PI * 2)
    ctx.fill()
  })

  // North arrow, top-right.
  const nx = width - padding - 6
  const ny = padding + 4
  ctx.strokeStyle = '#334155'
  ctx.fillStyle = '#334155'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(nx, ny + 22)
  ctx.lineTo(nx, ny)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(nx, ny)
  ctx.lineTo(nx - 4, ny + 8)
  ctx.lineTo(nx + 4, ny + 8)
  ctx.closePath()
  ctx.fill()
  ctx.font = 'bold 10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', nx, ny + 34)

  // Scale bar, bottom-left — nearest "nice" round metre value to ~1/4 span.
  const targetM = spanX / 4
  const barM = NICE_METRE_STEPS.reduce(
    (best, s) => (Math.abs(s - targetM) < Math.abs(best - targetM) ? s : best),
    NICE_METRE_STEPS[0],
  )
  const barPx = barM * scale
  const bx = padding
  const by = height - 16
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + barPx, by)
  ctx.moveTo(bx, by - 4)
  ctx.lineTo(bx, by + 4)
  ctx.moveTo(bx + barPx, by - 4)
  ctx.lineTo(bx + barPx, by + 4)
  ctx.stroke()
  ctx.fillStyle = '#334155'
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${barM} m`, bx, by - 7)
}

/** Renders the same boundary to an offscreen canvas and returns a PNG data URL. */
export function boundaryToDataUrl(ring, opts) {
  const canvas = document.createElement('canvas')
  canvas.width = opts.width
  canvas.height = opts.height
  const ctx = canvas.getContext('2d')
  drawBoundary(ctx, ring, { ...opts })
  return canvas.toDataURL('image/png')
}
