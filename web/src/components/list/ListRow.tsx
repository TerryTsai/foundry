import { ChevronRight } from 'lucide-react'
import { StatusBadge } from '../StatusBadge.js'

interface ListRowProps {
  title: string
  subtitle?: string
  status?: string
  active?: boolean
  mono?: boolean
  hideChevron?: boolean
  onPress?: () => void
}

export function ListRow({ title, subtitle, status, active, mono, hideChevron, onPress }: ListRowProps) {
  const cls = `w-full text-left border-b border-zinc-200 dark:border-zinc-800/50 active:bg-zinc-100 dark:active:bg-zinc-900/70 py-3 flex items-center gap-3 ${
    active ? 'bg-zinc-50 dark:bg-zinc-900/50' : ''
  }`

  const content = (
    <>
      <div className="flex-1 min-w-0">
        <div className={`text-zinc-900 dark:text-zinc-100 leading-snug truncate ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{title}</div>
        {subtitle && (
          <div className="text-xs text-zinc-600 dark:text-zinc-500 mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
      {!hideChevron && <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-700 shrink-0 -mr-1" strokeWidth={2} />}
    </>
  )
  return onPress
    ? <button onClick={onPress} className={cls}>{content}</button>
    : <div className={cls}>{content}</div>
}
