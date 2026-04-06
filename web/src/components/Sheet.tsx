import { useEffect } from 'react'
import { X } from 'lucide-react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-950 border-t border-zinc-800/60 rounded-t-2xl h-[70dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 shrink-0">
          <span className="text-sm font-semibold text-zinc-100">{title}</span>
          <button onClick={onClose}
            className="text-zinc-500 active:text-zinc-100 p-1 -mr-1">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 min-h-0 px-4 pt-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  )
}
