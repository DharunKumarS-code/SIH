import { useCallback, useEffect, useState } from 'react'

/**
 * useApi(fn, deps) — runs an async fn, tracks { data, error, loading } and
 * exposes reload(). Stale results are discarded on unmount / dependency change.
 * `fn` is expected to be stable enough for the given deps (typical usage passes
 * an inline arrow whose captured values are all listed in deps).
 */
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(() => fn())
      .then(
        (data) => alive && setState({ data, error: null, loading: false }),
        (error) => alive && setState({ data: null, error, loading: false }),
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { ...state, reload }
}
