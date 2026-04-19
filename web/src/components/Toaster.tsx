import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, Info, CheckCircle2 } from 'lucide-react'

export type ToastKind = 'error' | 'info' | 'success'
interface Toast { id: number; kind: ToastKind; message: string }

// Module-level bridge so non-React callers (QueryClient error handlers)
// can emit toasts. The <Toaster /> installs itself as the sink on mount.
let sink: ((t: Omit<Toast, 'id'>) => void) | null = null
export function pushToast(t: Omit<Toast, 'id'>) {
  sink?.(t)
}

const KIND_STYLES: Record<ToastKind, string> = {
  error:   'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200',
  info:    'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-200',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
}

function iconFor(kind: ToastKind) {
  if (kind === 'error')   return <AlertCircle size={14} className="shrink-0" />
  if (kind === 'success') return <CheckCircle2 size={14} className="shrink-0" />
  return <Info size={14} className="shrink-0" />
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, ...t }])
    window.setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id))
    }, 4000)
  }, [])

  useEffect(() => {
    sink = push
    return () => { if (sink === push) sink = null }
  }, [push])

  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="fixed z-[60] bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-[min(92vw,420px)] pointer-events-none"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto w-full flex items-start gap-2 px-3 py-2 rounded-lg border text-xs backdrop-blur-sm shadow-lg ${KIND_STYLES[t.kind]}`}
        >
          {iconFor(t.kind)}
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className="opacity-60 hover:opacity-100 shrink-0"
            aria-label="dismiss"
          >×</button>
        </div>
      ))}
    </div>
  )
}
