import { useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

// useState variant that persists per-location in sessionStorage so that
// UI toggles (expand/collapse, open panels) survive back-nav remounts.
// Cleared when the tab closes.
//
// Key is the caller's local id scoped to the current pathname. Two
// components on the same page using the same local id will share state
// — callers should namespace per-instance when needed.
export function usePersistedState<T>(
  localKey: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const { pathname } = useLocation()
  const storageKey = `ui:${pathname}:${localKey}`
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
