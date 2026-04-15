const dotColor: Record<string, string> = {
  opened:    'bg-sky-400',
  claimed:   'bg-amber-400',
  resolved:  'bg-emerald-400',
  finished:  'bg-emerald-400',
  failed:    'bg-red-400',
  cancelled: 'bg-zinc-400',
  active:    'bg-emerald-400',
  archived:  'bg-zinc-400',
  running:   'bg-sky-400',
  agent:     'bg-amber-400',
  founder:   'bg-sky-400',
  system:    'bg-zinc-400',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[status] ?? 'bg-zinc-400'}`} />
      <span className="text-[11px] text-zinc-600 dark:text-zinc-400 capitalize">{status}</span>
    </span>
  )
}
