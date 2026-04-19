import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { marked } from 'marked'
import { StatusBadge } from '../StatusBadge.js'
import { usePersistedState } from '../../lib/persisted-state.js'

interface ActivityRowProps {
  label:   string
  icon?:   React.ReactNode
  status?: string
  meta?:   string
  /** Optional secondary link rendered under the status badge.
   *  Reusable slot for "view execution", etc. */
  sub?:    { to: string; label: string }
  body?:   string
  mono?:   boolean
  footer?: React.ReactNode
  /** Fully custom expanded content. When provided, replaces the default
   *  body/mono/footer layout. Use for rich block-by-block renders. */
  children?: React.ReactNode
  /** When false, the row is static: no chevron, no toggle, no expanded
   *  section. Use for entries whose label says everything. Defaults true. */
  expandable?: boolean
  /** Optional stable id; when present, expand/collapse survives back-nav. */
  persistKey?: string
  /** When set, the whole row is a navigation Link. Implies non-expandable. */
  to?: string
}

export function ActivityRow({ label, icon, status, meta, sub, body, mono, footer, children, expandable = true, persistKey, to }: ActivityRowProps) {
  // A row that navigates elsewhere has no meaningful expand state.
  const isLink = typeof to === 'string'
  if (isLink) expandable = false
  const [expandedLocal, setExpandedLocal] = useState(false)
  const [expandedPersisted, setExpandedPersisted] = usePersistedState(`row:${persistKey ?? ''}`, false)
  const expanded = persistKey ? expandedPersisted : expandedLocal
  const setExpanded = persistKey ? setExpandedPersisted : setExpandedLocal

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
              {sub.label}
            </Link>
          )}
        </div>
      )}
      {expandable && (
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={`text-zinc-400 dark:text-zinc-700 shrink-0 -mr-1 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      )}
    </div>
  )

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/30 last:border-b-0">
      {isLink ? (
        <Link
          to={to!}
          className="block py-3.5 transition-colors duration-150 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40 active:bg-zinc-100 dark:active:bg-zinc-900/70"
        >
          {row}
        </Link>
      ) : expandable ? (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full text-left py-3.5 transition-colors duration-150 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40 active:bg-zinc-100 dark:active:bg-zinc-900/70"
        >
          {row}
        </button>
      ) : (
        <div className="py-3.5">{row}</div>
      )}

      {expandable && expanded && (
        <div className="pb-3 -mt-1">
          {children ?? (body ? (
            mono ? (
              <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre leading-relaxed select-text overflow-x-auto">{body}</pre>
            ) : (
              <div className="prose-zinc text-sm max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: marked.parse(body) as string }} />
            )
          ) : (
            <div className="text-xs text-zinc-500 dark:text-zinc-500 italic">no content</div>
          ))}
          {footer}
        </div>
      )}
    </div>
  )
}
