import { useState } from 'react'
import { RotateCw } from 'lucide-react'

export function SectionLabel({ label, onRefresh }: { label: string; onRefresh?: () => Promise<void> | void }) {
  const [spinning, setSpinning] = useState(false)
  async function handleRefresh() {
    if (!onRefresh || spinning) return
    setSpinning(true)
    try { await onRefresh() } finally { setSpinning(false) }
  }
  return (
    <div className="flex items-center justify-between pb-1 pt-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
        {label}
      </span>
      {onRefresh && (
        <button
          onClick={handleRefresh}
          disabled={spinning}
          className="text-zinc-500 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 disabled:opacity-30 p-1 -mr-1"
          aria-label="refresh"
        >
          <RotateCw size={11} strokeWidth={2} className={spinning ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  )
}
