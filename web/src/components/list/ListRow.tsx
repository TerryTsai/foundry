import { ChevronRight } from 'lucide-react'
import { StatusBadge } from '../StatusBadge.js'

interface ListRowProps {
  title: string
  subtitle?: string
  status?: string
  onPress: () => void
}

export function ListRow({ title, subtitle, status, onPress }: ListRowProps) {
  return (
    <button
      onClick={onPress}
      className="w-full text-left border-b border-zinc-800/50 active:bg-zinc-900/70 px-4 py-3 flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-zinc-100 text-sm leading-snug truncate">{title}</div>
        {subtitle && (
          <div className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
      <ChevronRight size={14} className="text-zinc-700 shrink-0 -mr-1" strokeWidth={2} />
    </button>
  )
}
