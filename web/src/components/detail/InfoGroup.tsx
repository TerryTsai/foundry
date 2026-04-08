import { Link } from 'react-router-dom'

interface InfoRow {
  label: string
  value: React.ReactNode
  href?: string
}

export function InfoGroup({ rows }: { rows: InfoRow[] }) {
  return (
    <div className="text-sm space-y-1.5 border-y border-zinc-100 dark:border-zinc-800 py-3">
      {rows.filter(r => r.value != null).map(({ label, value, href }) => (
        <div key={label} className="flex gap-3">
          <span className="text-zinc-400 dark:text-zinc-500 shrink-0 w-20">{label}</span>
          {href ? (
            <Link to={href} className="text-amber-500 dark:text-amber-400 font-mono text-xs leading-5 break-all">
              {value}
            </Link>
          ) : (
            <span className="text-zinc-700 dark:text-zinc-300 font-mono text-xs leading-5 break-all">{value}</span>
          )}
        </div>
      ))}
    </div>
  )
}
