import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

interface InfoRow {
  label: string
  value: React.ReactNode
  href?: string
}

export function InfoGroup({ rows, primaryCount = 3 }: { rows: InfoRow[]; primaryCount?: number }) {
  const visible = rows.filter(r => r.value != null)
  const hasMore = visible.length > primaryCount
  const [expanded, setExpanded] = useState(false)
  const shown = hasMore && !expanded ? visible.slice(0, primaryCount) : visible

  return (
    <div className="text-sm border-y border-zinc-200 dark:border-zinc-800 py-3">
      <div className="space-y-1.5">
        {shown.map(({ label, value, href }) => (
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
        ))}
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
