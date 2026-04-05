const colors: Record<string, string> = {
  open: 'bg-blue-900/60 text-blue-300',
  claimed: 'bg-yellow-900/60 text-yellow-300',
  done: 'bg-green-900/60 text-green-300',
  failed: 'bg-red-900/60 text-red-300',
  blocked: 'bg-purple-900/60 text-purple-300',
  active: 'bg-green-900/60 text-green-300',
  paused: 'bg-zinc-800 text-zinc-400',
  running: 'bg-yellow-900/60 text-yellow-300',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${colors[status] ?? 'bg-zinc-800 text-zinc-400'}`}>
      {status}
    </span>
  )
}
