import { useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

// useState variant that persists per-history-entry in sessionStorage so
// that UI toggles (expand/collapse, open panels) survive back-nav
// remounts but reset on fresh forward-nav — matching browser-standard
// scroll behavior.
//
// Keyed by location.key so each history entry has its own state. A
// forward-nav to a previously-visited URL mints a new key → fresh state.
// Back-nav returns to the old key → state rehydrates. Cleared when the
// tab closes.
export function usePersistedState<T>(
  localKey: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const { key } = useLocation()
  const storageKey = `ui:${key}:${localKey}`
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw != null) return JSON.parse(raw) as T
    } catch { /* ignore */ }
    return initial
  })
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      try { sessionStorage.setItem(storageKey, JSON.stringify(resolved)) } catch { /* ignore */ }
      return resolved
    })
  }, [storageKey])
  return [state, set]
}
