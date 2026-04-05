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
      className="w-full text-left border-b border-zinc-800/50 active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-zinc-200 text-sm leading-snug truncate">{title}</div>
        {subtitle && (
          <div className="font-mono text-[10px] text-zinc-600 mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
    </button>
  )
}
