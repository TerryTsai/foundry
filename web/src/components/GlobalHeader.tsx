import { ChevronDown } from 'lucide-react'
import type { Project } from '../types.js'

// Foundry logo mark — geometric anvil/forge shape
function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect x="2" y="13" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.9" />
      <path d="M6 13 L7.5 5 L12.5 5 L14 13" fill="currentColor" opacity="0.6" />
      <rect x="8" y="3" width="4" height="3" rx="1" fill="currentColor" />
    </svg>
  )
}

interface GlobalHeaderProps {
  title: string
  project: Project | null
  onSwitch: () => void
}

export function GlobalHeader({ title, project, onSwitch }: GlobalHeaderProps) {
  const dotColor = project?.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-500'

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-800/60 shrink-0">
      <div className="flex items-center gap-2.5 text-zinc-100">
        <FoundryMark />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <button
        onClick={onSwitch}
        className="flex items-center gap-2 active:opacity-75 transition-opacity"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-sm text-zinc-400">{project?.name ?? '—'}</span>
        <ChevronDown size={13} className="text-zinc-500" strokeWidth={2} />
      </button>
    </div>
  )
}
