import { useState } from 'react'
import { Ticket, Bot, FolderOpen, Key, ChevronDown, Pause, Play, Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import type { Tab } from './TabBar.js'
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

const tabs: Array<{ id: Tab; label: string; Icon: LucideIcon }> = [
  { id: 'tickets',   label: 'Tickets',   Icon: Ticket },
  { id: 'agents',    label: 'Agents',    Icon: Bot },
  { id: 'files',     label: 'Files',     Icon: FolderOpen },
  { id: 'providers', label: 'Providers', Icon: Key },
]

const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark']

interface SidebarProps {
  tab: Tab
  onTabChange: (tab: Tab) => void
  project: Project | null
  onSwitch: () => void
  onToggle: () => Promise<void>
}

export function Sidebar({ tab, onTabChange, project, onSwitch, onToggle }: SidebarProps) {
  const { mode, setMode } = useTheme()
  const [toggling, setToggling] = useState(false)
  const isActive = project?.status === 'active'

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length]
    setMode(next)
  }

  async function handleToggle() {
    setToggling(true)
    try { await onToggle() } finally { setToggling(false) }
  }

  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 shrink-0">
        <FoundryMark />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-display">Foundry</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-0.5 px-2 pt-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === t.id
                ? 'text-amber-400 bg-amber-400/5'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900'
            }`}
          >
            <t.Icon size={18} strokeWidth={1.5} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800/60 p-2 space-y-1">
        {/* Project selector */}
        <button
          onClick={onSwitch}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        >
          <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{project?.name ?? '—'}</span>
          <ChevronDown size={13} className="text-zinc-400 dark:text-zinc-500 shrink-0" strokeWidth={2} />
        </button>

        {/* Theme + play/pause row */}
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={cycleTheme}
            title={`Theme: ${mode}`}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ThemeIcon size={14} strokeWidth={1.75} />
          </button>

          {project && (
            <button
              onClick={handleToggle}
              disabled={toggling}
              title={isActive ? 'Pause' : 'Resume'}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30"
            >
              {isActive
                ? <Pause size={14} strokeWidth={1.75} className="text-zinc-400 dark:text-zinc-400" />
                : <Play  size={14} strokeWidth={1.75} className="text-amber-400" />
              }
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
