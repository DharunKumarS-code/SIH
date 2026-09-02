// Small geometry helpers for generating demo GeoJSON around Chennai (OMR /
// Sholinganallur). Metre <-> degree conversion is a local tangent-plane
// approximation, which is plenty accurate for a neighbourhood-scale prototype.

const M_PER_DEG_LAT = 111_320

export const mToDegLat = (m) => m / M_PER_DEG_LAT
export const mToDegLon = (m, lat) => m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))

/** Axis-aligned rectangle polygon ring centred on (lon,lat). Returns [[lon,lat]...] closed. */
export function rectRing(lon, lat, widthM, depthM) {
  const dLon = mToDegLon(widthM / 2, lat)
  const dLat = mToDegLat(depthM / 2)
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ]
}

/** GeoJSON Polygon from a single ring. */
export const polygon = (ring) => ({ type: 'Polygon', coordinates: [ring] })

/** GeoJSON Point. */
export const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] })

/**
 * Divide a rectangle into cols x rows cells. Returns cells row-major
 * (top row first) as { ring, col, row, index, centroid }.
 */
export function gridCells(lon, lat, widthM, depthM, cols, rows) {
  const cells = []
  const totalDLon = mToDegLon(widthM, lat)
  const totalDLat = mToDegLat(depthM)
  const x0 = lon - totalDLon / 2
  const y0 = lat - totalDLat / 2
  const cw = totalDLon / cols
  const ch = totalDLat / rows
  let index = 0
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = 0; c < cols; c += 1) {
      const cx0 = x0 + c * cw
      const cy0 = y0 + r * ch
      // small inset so adjacent units read as separate boxes
      const ix = cw * 0.08
      const iy = ch * 0.08
      const ring = [
        [cx0 + ix, cy0 + iy],
        [cx0 + cw - ix, cy0 + iy],
        [cx0 + cw - ix, cy0 + ch - iy],
        [cx0 + ix, cy0 + ch - iy],
        [cx0 + ix, cy0 + iy],
      ]
      cells.push({
        ring,
        col: c,
        row: rows - 1 - r,
        index: index++,
        centroid: [cx0 + cw / 2, cy0 + ch / 2],
      })
    }
  }
  return cells
}

/** Rough bounding box [minLon,minLat,maxLon,maxLat] of a polygon ring. */
export function bbox(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/** Approximate polygon area in m² (shoelace on the tangent plane). */
export function ringAreaM2(ring, lat) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    a += x1 * y2 - x2 * y1
  }
  const degLatM = M_PER_DEG_LAT
  const degLonM = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
  return Math.abs(a / 2) * degLatM * degLonM
}
