import { useState } from 'react'
import { ChevronDown, Pause, Play } from 'lucide-react'
import type { Project } from '../types.js'

// Foundry logo mark — geometric anvil/forge shape
function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
      <rect x="2" y="13" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.9" />
      <path d="M6 13 L7.5 5 L12.5 5 L14 13" fill="currentColor" opacity="0.55" />
      <rect x="8" y="3" width="4" height="3" rx="1" fill="currentColor" />
    </svg>
  )
}

interface GlobalHeaderProps {
  title: string
  project: Project | null
  onSwitch: () => void
  onToggle: () => Promise<void>
}

export function GlobalHeader({ title, project, onSwitch, onRun, onToggle }: GlobalHeaderProps) {
  const [toggling, setToggling] = useState(false)

  const isActive = project?.status === 'active'
  const dotColor = isActive ? 'bg-sky-400' : 'bg-zinc-500'

  async function handleToggle() {
    setToggling(true)
    try { await onToggle() } finally { setToggling(false) }
  }

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-800/60 shrink-0">
      <div className="flex items-center gap-2.5 text-zinc-100">
        <FoundryMark />
        <span className="text-sm font-semibold">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        {/* Pause / Resume */}
        {project && (
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={isActive ? 'Pause' : 'Resume'}
            className="flex items-center justify-center w-8 h-8 rounded-lg active:bg-zinc-800 transition-colors disabled:opacity-30"
          >
            {isActive
              ? <Pause size={14} strokeWidth={1.75} className="text-zinc-400" />
              : <Play  size={14} strokeWidth={1.75} className="text-amber-400" />
            }
          </button>
        )}

        {/* Project switcher */}
        <button
          onClick={onSwitch}
          className="flex items-center gap-2 pl-1 active:opacity-75 transition-opacity"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          <span className="text-sm text-zinc-400">{project?.name ?? '—'}</span>
          <ChevronDown size={13} className="text-zinc-500" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
