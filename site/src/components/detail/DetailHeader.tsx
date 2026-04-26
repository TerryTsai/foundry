import { StatusBadge } from '../StatusBadge.js'

interface DetailHeaderProps {
  type: string
  title: string
  status?: string
  mono?: boolean
  actions?: React.ReactNode
}

export function DetailHeader({ type, title, status, mono, actions }: DetailHeaderProps) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
          {type}
        </div>
        {actions}
      </div>
      <div className="flex items-start justify-between gap-2 mt-0.5">
        <h2 className={`text-sm font-semibold text-zinc-900 dark:text-zinc-100 min-w-0 ${mono ? 'font-mono truncate' : ''}`}>
          {title}
        </h2>
        {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
      </div>
    </div>
  )
}
