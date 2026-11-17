// One shared loader for the 3D map route (Map3D + CesiumJS, ~1.3 MB). The
// promise is memoised, so hovering/focusing the nav link many times starts
// at most one download, and the route's lazy() import reuses it. A failed
// download is forgotten so the next attempt (or lazyWithRetry) tries again.
// Nothing is fetched unless a user shows intent to open the map.
let pending = null

export function loadMap3D() {
  if (!pending) {
    pending = import('../pages/Map3D.jsx').catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

export function preloadMap3D() {
  loadMap3D().catch(() => {})
}
