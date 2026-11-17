import { createElement, lazy, useState } from 'react'

// ---------------------------------------------------------------------------
// lazyWithRetry — React.lazy() that survives a transient dynamic-import failure.
//
// Vite's dev server can briefly 404 a lazy chunk while it re-optimizes deps
// (e.g. the first visit to a Three.js "explorer" route on a long-running dev
// server), and a stale production deploy can 404 an old hashed chunk after a
// new build. Either way the raw import() rejects with "Failed to fetch
// dynamically imported module" and, with no retry, React.lazy propagates it to
// the nearest error boundary — a blank "Something went wrong" page.
//
// This wrapper keeps the SAME lazy-loading architecture (still
// lazy(() => import(...))) and only adds resilience: one automatic retry after
// a short delay, then — once per module, guarded by sessionStorage so we never
// loop — a single hard reload to pull the fresh module graph.
// ---------------------------------------------------------------------------
//
// The returned component also has `preload()`. Once its module has loaded
// (via preload or a first render) it renders the module directly — no
// suspension, so no Suspense fallback flash and no React reveal throttle.
// ---------------------------------------------------------------------------
export function lazyWithRetry(factory, key = factory.toString().slice(0, 120)) {
  let Loaded = null
  const load = () =>
    factory().then((mod) => {
      Loaded = mod.default
      return mod
    })
  const Lazy = lazy(async () => {
    const storageKey = `lazy-retry:${key}`
    try {
      const mod = await load()
      try { window.sessionStorage?.removeItem(storageKey) } catch { /* ignore */ }
      return mod
    } catch (err) {
      // one in-place retry — covers a dep re-optimize that has since settled
      await new Promise((r) => setTimeout(r, 600))
      try {
        return await load()
      } catch (err2) {
        let alreadyReloaded = false
        try { alreadyReloaded = window.sessionStorage?.getItem(storageKey) === '1' } catch { /* ignore */ }
        if (!alreadyReloaded && typeof window !== 'undefined') {
          try { window.sessionStorage?.setItem(storageKey, '1') } catch { /* ignore */ }
          window.location.reload()
          // return a never-resolving module so React shows the Suspense
          // fallback during the reload rather than flashing the error boundary
          return new Promise(() => {})
        }
        throw err2 || err
      }
    }
  })
  function LazyWithRetry(props) {
    // The type is fixed per mounted instance: an instance that mounted via
    // Lazy keeps rendering Lazy (already resolved => synchronous), so a later
    // re-render never swaps the element type and remounts the subtree.
    const [Type] = useState(() => Loaded || Lazy)
    return createElement(Type, props)
  }
  // Resolves when the module is loaded; never rejects (a failed preload just
  // leaves the normal lazy path, with its retry/reload handling, in charge).
  LazyWithRetry.preload = () => (Loaded ? Promise.resolve() : load().then(() => {}, () => {}))
  return LazyWithRetry
}
