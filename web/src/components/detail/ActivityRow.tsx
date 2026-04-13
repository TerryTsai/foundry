import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { marked } from 'marked'
import { StatusBadge } from '../StatusBadge.js'

interface ActivityRowProps {
  label:   string
  icon?:   React.ReactNode
  status?: string
  meta?:   string
  /** Optional secondary link rendered under the status badge.
   *  Reusable slot for "view execution", "view session", etc. */
  sub?:    { to: string; label: string }
  body:    string
  mono?:   boolean
  footer?: React.ReactNode
}

export function ActivityRow({ label, icon, status, meta, sub, body, mono, footer }: ActivityRowProps) {
  const [expanded, setExpanded] = useState(false)

  const row = (
    <div className="flex items-start gap-3">
      {icon && <div className="shrink-0 text-zinc-600 dark:text-zinc-500 pt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="truncate leading-snug text-sm text-zinc-900 dark:text-zinc-100">
          {label}
        </div>
        {meta && <div className="text-xs text-zinc-600 dark:text-zinc-500 mt-0.5 truncate">{meta}</div>}
      </div>
      {(status || sub) && (
        <div className="shrink-0 flex flex-col items-end gap-1">
          {status && <StatusBadge status={status} />}
          {sub && (
            <Link
              to={sub.to}
              onClick={e => e.stopPropagation()}
              className="font-mono text-[10px] text-amber-500 dark:text-amber-400 hover:underline"
            >
              {sub.label} →
            </Link>
          )}
        </div>
      )}
      <ChevronRight
        size={14}
        strokeWidth={2}
        className={`text-zinc-400 dark:text-zinc-700 shrink-0 -mr-1 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
    </div>
  )

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/30 last:border-b-0">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left py-3 active:bg-zinc-100 dark:active:bg-zinc-900/70"
      >
        {row}
      </button>

      {expanded && (
        <div className="pb-3 -mt-1">
          {body ? (
            mono ? (
              <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre leading-relaxed select-text overflow-x-auto">{body}</pre>
            ) : (
              <div className="prose-zinc text-sm max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: marked.parse(body) as string }} />
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
