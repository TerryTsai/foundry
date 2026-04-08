import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { marked } from 'marked'
import { StatusBadge } from '../StatusBadge.js'

interface ActivityRowProps {
  label: string
  icon?: React.ReactNode
  detailHref?: string
  detailLabel?: string
  status?: string
  meta?: string
  body: string
  mono?: boolean
  footer?: React.ReactNode
}

export function ActivityRow({ label, icon, detailHref, detailLabel, status, meta, body, mono, footer }: ActivityRowProps) {
  const [expanded, setExpanded] = useState(false)

  const row = (
    <div className="flex items-center gap-3">
      {icon && <div className="shrink-0 text-zinc-600 dark:text-zinc-500">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className={`truncate leading-snug ${mono ? 'font-mono text-xs text-zinc-900 dark:text-zinc-100' : 'text-sm text-zinc-900 dark:text-zinc-100'}`}>
          {label}
        </div>
        {meta && <div className="text-xs text-zinc-600 dark:text-zinc-500 mt-0.5 truncate">{meta}</div>}
      </div>
      {status && <div className="shrink-0"><StatusBadge status={status} /></div>}
      <ChevronRight
        size={14}
        strokeWidth={2}
        className={`text-zinc-400 dark:text-zinc-700 shrink-0 -mr-1 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
    </div>
  )

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/30 last:border-b-0">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-4 py-3 active:bg-zinc-100 dark:active:bg-zinc-900/70"
      >
        {row}
      </button>

      {expanded && (
        <div className="px-4 pb-3 -mt-1">
          {detailHref && (
            <Link
              to={detailHref}
              className="inline-block font-mono text-[10px] text-amber-500 dark:text-amber-400 mb-2 hover:underline"
            >
              {detailLabel ?? 'details'} →
            </Link>
          )}
          {body ? (
            mono ? (
              <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-all leading-relaxed select-text">{body}</pre>
            ) : (
              <div className="prose-zinc text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(body) as string }} />
            )
          ) : (
            <div className="text-xs text-zinc-500 dark:text-zinc-500 italic">no content</div>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}
