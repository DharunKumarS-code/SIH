// Viewport query for one-time initial UI state (e.g. whether a map panel
// starts open). Safe outside the browser / when matchMedia is unavailable:
// it then reports a match, so panels keep their full desktop default.
export function mediaMatches(query) {
  try {
    return typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches
  } catch {
    return true
  }
}
