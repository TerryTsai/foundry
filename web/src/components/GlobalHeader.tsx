import type { Project } from '../types.js'

interface GlobalHeaderProps {
  project: Project | null
  onSwitch: () => void
}

export function GlobalHeader({ project, onSwitch }: GlobalHeaderProps) {
  const dotColor = project?.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-600'

  return (
    <div className="flex items-center px-4 h-12 border-b border-zinc-800 shrink-0">
      <button
        onClick={onSwitch}
        className="flex items-center gap-2.5 active:opacity-75 transition-opacity"
      >
        <span className={`w-1.5 h-1.5 shrink-0 ${dotColor}`} />
        <span className="text-sm font-semibold text-zinc-100">
          {project?.name ?? '—'}
        </span>
        <span className="font-mono text-[10px] text-zinc-600 ml-0.5">↓</span>
      </button>
    </div>
  )
}
