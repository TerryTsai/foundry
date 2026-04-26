import { Link } from 'react-router-dom'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  message: string
  /** Optional inline CTA — either a route (Link) or a click handler. */
  action?: { label: string; to?: string; onPress?: () => void }
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-3">
      <Inbox size={28} className="text-zinc-400 dark:text-zinc-700" strokeWidth={1.25} />
      <p className="text-sm text-zinc-500 dark:text-zinc-500">{message}</p>
      {action && (action.to
        ? <Link to={action.to} className="text-xs text-sky-600 dark:text-sky-400 hover:underline">{action.label}</Link>
        : <button onClick={action.onPress} className="text-xs text-sky-600 dark:text-sky-400 hover:underline">{action.label}</button>
      )}
    </div>
  )
}
