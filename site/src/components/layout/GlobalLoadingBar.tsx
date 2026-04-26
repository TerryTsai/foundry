import { useEffect, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'

// Thin indeterminate progress bar pinned to the top of the viewport.
// Tracks any in-flight query or mutation across the app.
//
// Delayed 150ms so brief requests never flash; fades in over 200ms for
// a calm reveal. Uses the loadbar keyframes in index.css.
export function GlobalLoadingBar() {
  const fetching = useIsFetching()
  const mutating = useIsMutating()
  const busy = fetching + mutating > 0
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!busy) { setShow(false); return }
    const t = window.setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [busy])

  return (
    <div
      aria-hidden
      className={`fixed top-0 inset-x-0 h-0.5 z-50 pointer-events-none overflow-hidden transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="h-full w-1/3 bg-amber-500 animate-[loadbar_1.2s_ease-in-out_infinite]" />
    </div>
  )
}
