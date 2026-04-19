import { StatusBadge } from '../StatusBadge.js'

interface ListRowProps {
  title: string
  subtitle?: string
  status?: string
  active?: boolean
  mono?: boolean
  onPress?: () => void
}

export function ListRow({ title, subtitle, status, active, mono, onPress }: ListRowProps) {
  // Hover fill: radial gradient centered on the row, fading smoothly
  // to transparent in all directions. Zero hard edges. Press (active)
  // uses a flat fill for crisp press feedback.
  const cls = `w-full text-left border-b border-zinc-200 dark:border-zinc-800/50 py-3.5 flex items-center gap-3 hover:bg-[radial-gradient(80%_100%_at_center,theme(colors.zinc.100/60%),transparent)] dark:hover:bg-[radial-gradient(80%_100%_at_center,theme(colors.zinc.800/50%),transparent)] active:bg-zinc-100 dark:active:bg-zinc-900/70 ${
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
    </>
  )
  return onPress
    ? <button onClick={onPress} className={cls}>{content}</button>
    : <div className={cls}>{content}</div>
}
