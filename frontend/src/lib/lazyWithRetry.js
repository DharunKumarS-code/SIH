import { lazy } from 'react'

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
export function lazyWithRetry(factory, key = factory.toString().slice(0, 120)) {
  return lazy(async () => {
    const storageKey = `lazy-retry:${key}`
    try {
      const mod = await factory()
      try { window.sessionStorage?.removeItem(storageKey) } catch { /* ignore */ }
      return mod
    } catch (err) {
      // one in-place retry — covers a dep re-optimize that has since settled
      await new Promise((r) => setTimeout(r, 600))
      try {
        return await factory()
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
}
