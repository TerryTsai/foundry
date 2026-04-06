const dotColor: Record<string, string> = {
  open:    'bg-sky-400',
  claimed: 'bg-amber-400',
  done:    'bg-emerald-400',
  failed:  'bg-red-400',
  blocked: 'bg-purple-400',
  active:  'bg-emerald-400',
  paused:  'bg-zinc-500',
  running: 'bg-sky-400',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[status] ?? 'bg-zinc-500'}`} />
      <span className="text-[11px] text-zinc-400 capitalize">{status}</span>
    </span>
  )
}
