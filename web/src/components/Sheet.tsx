import { useEffect } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export function Sheet({ open, onClose, children }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/60 shrink-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            detail
          </span>
          <button onClick={onClose}
            className="font-mono text-xs text-zinc-400 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 px-1 py-1">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-10 pt-4">
          {children}
        </div>
      </div>
    </div>
  )
}
