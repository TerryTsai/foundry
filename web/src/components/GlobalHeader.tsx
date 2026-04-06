import { useState } from 'react'
import { ChevronDown, Pause, Play, Sun, Moon, Monitor } from 'lucide-react'
import type { Project } from '../types.js'
import { useTheme, type ThemeMode } from '../theme.js'

function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
      <path d="M10 1 L19 10 L10 19 L1 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 5.5 L14.5 10 L10 14.5 L5.5 10 Z" fill="currentColor" />
    </svg>
  )
}

const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark']

function ThemeToggle() {
  const { mode, setMode } = useTheme()

  function cycle() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length]
    setMode(next)
  }

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  return (
    <button
      onClick={cycle}
      title={`Theme: ${mode}`}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 dark:text-zinc-500 active:text-zinc-700 dark:active:text-zinc-200 active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors"
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  )
}

interface GlobalHeaderProps {
  title: string
  project: Project | null
  onSwitch: () => void
  onToggle: () => Promise<void>
}

export function GlobalHeader({ title, project, onSwitch, onToggle }: GlobalHeaderProps) {
  const [toggling, setToggling] = useState(false)
  const isActive = project?.status === 'active'

  async function handleToggle() {
    setToggling(true)
    try { await onToggle() } finally { setToggling(false) }
  }

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-200 dark:border-zinc-800/60 shrink-0">
      <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100">
        <FoundryMark />
        <span className="text-sm font-semibold">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {project && (
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={isActive ? 'Pause' : 'Resume'}
            className="flex items-center justify-center w-8 h-8 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors disabled:opacity-30"
          >
            {isActive
              ? <Pause size={14} strokeWidth={1.75} className="text-zinc-400 dark:text-zinc-400" />
              : <Play  size={14} strokeWidth={1.75} className="text-amber-400" />
            }
          </button>
        )}

        <button
          onClick={onSwitch}
          className="flex items-center gap-2 pl-1 active:opacity-75 transition-opacity"
        >
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{project?.name ?? '—'}</span>
          <ChevronDown size={13} className="text-zinc-400 dark:text-zinc-500" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
