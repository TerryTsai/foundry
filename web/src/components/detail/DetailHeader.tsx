import { marked } from 'marked'
import { StatusBadge } from '../StatusBadge.js'

interface DetailHeaderProps {
  type: string
  title: string
  subtitle?: string
  status?: string
  mono?: boolean
  actions?: React.ReactNode
}

export function DetailHeader({ type, title, subtitle, status, mono, actions }: DetailHeaderProps) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
          {type}
        </div>
        {actions}
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <h2 className={`text-sm font-semibold text-zinc-900 dark:text-zinc-100 min-w-0 ${mono ? 'font-mono truncate' : ''}`}>
          {title}
        </h2>
        {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
      </div>
      {subtitle && (
        <div className="prose-zinc text-sm text-zinc-700 dark:text-zinc-400 mt-1" dangerouslySetInnerHTML={{ __html: marked.parse(subtitle) as string }} />
      )}
    </div>
  )
}
