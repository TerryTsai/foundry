const dotColor: Record<string, string> = {
  open:    'bg-blue-500',
  claimed: 'bg-amber-500',
  done:    'bg-emerald-500',
  failed:  'bg-red-500',
  blocked: 'bg-purple-500',
  active:  'bg-emerald-500',
  paused:  'bg-zinc-400',
  running: 'bg-amber-500',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`inline-block w-1.5 h-1.5 shrink-0 ${dotColor[status] ?? 'bg-zinc-400'}`} />
      <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        {status}
      </span>
    </span>
  )
}
