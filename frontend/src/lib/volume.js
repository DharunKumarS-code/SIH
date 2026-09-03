// Front-end helpers for the prototype 3D volume model (Phase 2).
// Mirrors backend/src/services/geometry3d/. X/Y are WGS-84 degrees, Z is metres.

const M_PER_DEG_LAT = 111320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/** Client-side fallback: derive a volume from a GIS feature if the API omitted one. */
export function volumeFromFeature(feature) {
  const p = feature?.properties || {}
  if (p.volume) return p.volume
  const ring = feature?.geometry?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  return {
    volumeId: p.volumeId || null,
    xmin, xmax, ymin, ymax,
    zmin: finite(p.baseHeight) ? p.baseHeight : null,
    zmax: finite(p.topHeight) ? p.topHeight : null,
    geometryVersion: 1,
    source: p.verificationStatus || 'DEMO',
    prototype: true,
    status: 'UNVALIDATED',
  }
}

/** Derived metrics for display; null where a rectangular estimate isn't meaningful. */
export function volumeMetrics(v) {
  if (!v || !finite(v.xmin)) return null
  const latMid = (v.ymin + v.ymax) / 2
  const heightM = finite(v.zmin) && finite(v.zmax) ? +(v.zmax - v.zmin).toFixed(2) : null
  const widthM = +((v.xmax - v.xmin) * mPerDegLon(latMid)).toFixed(2)
  const depthM = +((v.ymax - v.ymin) * M_PER_DEG_LAT).toFixed(2)
  const footprintM2 = widthM && depthM ? +(widthM * depthM).toFixed(1) : null
  const volumeM3 = footprintM2 != null && heightM != null ? +(footprintM2 * heightM).toFixed(1) : null
  return { heightM, widthM, depthM, footprintM2, volumeM3 }
}

const fmtDeg = (n) => (finite(n) ? n.toFixed(6) : '—')
const fmtM = (n) => (finite(n) ? `${n.toFixed(2)} m` : '—')

/** Label/value pairs for the sidebar "3D Geometry" section. */
export function volumeBoundsRows(v) {
  if (!v) return {}
  return {
    'X min (lon°)': fmtDeg(v.xmin),
    'X max (lon°)': fmtDeg(v.xmax),
    'Y min (lat°)': fmtDeg(v.ymin),
    'Y max (lat°)': fmtDeg(v.ymax),
    'Z min': fmtM(v.zmin),
    'Z max': fmtM(v.zmax),
  }
}

/** { tone, label } for a VALID | WARNING | ERROR | UNVALIDATED geometry status. */
export function geometryStatusTone(status) {
  switch (status) {
    case 'VALID': return { tone: 'ok', label: 'VALID' }
    case 'WARNING': return { tone: 'warn', label: 'WARNING' }
    case 'ERROR': return { tone: 'err', label: 'ERROR' }
    default: return { tone: 'muted', label: status || 'UNVALIDATED' }
  }
}
