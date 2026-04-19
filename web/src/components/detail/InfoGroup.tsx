import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

interface InfoRow {
  label: string
  value: React.ReactNode
  href?: string
  // Rows marked primary are always shown regardless of primaryCount —
  // for fields whose value is important enough that folding them away
  // defeats the purpose (e.g. tags).
  primary?: boolean
}

export function InfoGroup({ rows, primaryCount = 3 }: { rows: InfoRow[]; primaryCount?: number }) {
  const visible = rows.filter(r => r.value != null)

  // A row is "always shown" if it's either marked primary or sits in
  // the first `primaryCount` non-primary rows. Everything else goes
  // into the foldable middle.
  let nonPrimarySeen = 0
  const alwaysShown = new Set<number>()
  visible.forEach((r, i) => {
    if (r.primary) { alwaysShown.add(i); return }
    if (nonPrimarySeen < primaryCount) alwaysShown.add(i)
    nonPrimarySeen++
  })
  const hasMore = visible.length > alwaysShown.size
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="text-sm border-y border-zinc-200 dark:border-zinc-800 py-3">
      <div className="space-y-1.5">
        {visible.map(({ label, value, href }, i) => {
          if (!expanded && !alwaysShown.has(i)) return null
          return (
            <div key={label} className="flex gap-3 select-text">
              <span className="text-zinc-600 dark:text-zinc-500 shrink-0 w-20">{label}</span>
              {href ? (
                <Link to={href} className="text-amber-500 dark:text-amber-400 font-mono text-xs leading-5 break-all">
                  {value}
                </Link>
              ) : (
                <span className="text-zinc-900 dark:text-zinc-300 font-mono text-xs leading-5 break-all">{value}</span>
              )}
            </div>
          )
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex justify-center pt-2 active:opacity-60"
        >
          <ChevronDown size={12} className={`text-zinc-400 dark:text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}
