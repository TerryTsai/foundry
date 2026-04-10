import { useState } from 'react'
import { Outlet, NavLink, ScrollRestoration, useParams, useLoaderData, useRevalidator } from 'react-router-dom'
import { Ticket, Bot, FolderOpen, Pause, Play, Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { projectApi } from './api.js'
import type { Project } from './types.js'
import { useTheme, type ThemeMode } from './theme.js'
import { MobileBreadcrumb } from './Breadcrumb.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
// ── Foundry Mark ──
function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
      <path d="M10 1 L19 10 L10 19 L1 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 5.5 L14.5 10 L10 14.5 L5.5 10 Z" fill="currentColor" />
    </svg>
  )
}
// ── Nav items ──
const navItems: Array<{ to: string; label: string; Icon: LucideIcon }> = [
  { to: 'tickets', label: 'Tickets', Icon: Ticket },
  { to: 'agents',  label: 'Agents',  Icon: Bot },
  { to: 'files',   label: 'Files',   Icon: FolderOpen },
]
const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark']
// ── Desktop Top Bar ──
function DesktopTopBar({
  projectId,
  current,
  onToggle,
}: {
  projectId: string
  current: Project | null
  onToggle: () => Promise<void>
}) {
  const { mode, setMode } = useTheme()
  const [toggling, setToggling] = useState(false)
  const isActive = current?.status === 'active'
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
    <header className="hidden lg:flex items-center h-12 shrink-0 px-4 gap-4 border-b border-zinc-300 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0 mr-2">
        <FoundryMark />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-display">Foundry</span>
      </div>
      {/* Nav links */}
      <nav className="flex items-center gap-1 flex-1">
        {navItems.map(t => (
          <NavLink
            key={t.to}
            to={`/p/${projectId}/${t.to}`}
            className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              isActive
                ? 'text-amber-400 bg-amber-400/5'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900'
            }`}
          >
            <t.Icon size={16} strokeWidth={1.5} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      {/* Right-side actions */}
      <div className="flex items-center gap-1 shrink-0">
        <ProjectSwitcher current={current} projectId={projectId} />
        <button
          onClick={cycleTheme}
          title={`Theme: ${mode}`}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ThemeIcon size={14} strokeWidth={1.75} />
        </button>
        {current && (
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
    </header>
  )
}
// ── Mobile Tab Bar ──
function MobileTabBar({ projectId }: { projectId: string }) {
  return (
    <nav className="flex lg:hidden border-t border-zinc-300 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 shrink-0">
      {navItems.map(t => (
        <NavLink
          key={t.to}
          to={`/p/${projectId}/${t.to}`}
          className={({ isActive }) => `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors relative ${
            isActive ? 'text-amber-400' : 'text-zinc-500 dark:text-zinc-500'
          }`}
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-px bg-amber-400 rounded-full" />}
              <t.Icon size={18} strokeWidth={1.5} />
              <span className="text-[10px] leading-none">{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
// ── Mobile Header ──
function MobileHeader({
  project, projectId, onToggle,
}: {
  project: Project | null
  projectId: string
  onToggle: () => Promise<void>
}) {
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
    <div className="flex lg:hidden items-center gap-2 px-3 h-11 shrink-0 border-b border-zinc-300 dark:border-zinc-800/60">
      <MobileBreadcrumb fallback={<FoundryMark />} />
      <div className="flex items-center gap-0.5 ml-auto shrink-0">
        <button onClick={cycleTheme} className="flex items-center justify-center w-7 h-7 text-zinc-400 dark:text-zinc-500">
          <ThemeIcon size={13} strokeWidth={1.75} />
        </button>
        {project && (
          <button onClick={handleToggle} disabled={toggling} className="flex items-center justify-center w-7 h-7 disabled:opacity-30">
            {isActive
              ? <Pause size={13} strokeWidth={1.75} className="text-zinc-400" />
              : <Play  size={13} strokeWidth={1.75} className="text-amber-400" />
            }
          </button>
        )}
        <ProjectSwitcher
          current={project}
          projectId={projectId}
          className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500 truncate max-w-[140px] pl-1 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        />
      </div>
    </div>
  )
}
// ── Shell ──
export function Shell() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useLoaderData() as Project
  const { revalidate } = useRevalidator()
  async function handleToggle() {
    if (!project) return
    await projectApi.update(project.id, { status: project.status === 'active' ? 'archived' : 'active' })
    revalidate()
  }
  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-zinc-950">
      <DesktopTopBar
        projectId={projectId!}
        current={project}
        onToggle={handleToggle}
      />
      <MobileHeader project={project} projectId={projectId!} onToggle={handleToggle} />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <ScrollRestoration />
        <Outlet context={{ project, projectId: projectId!, revalidate }} />
      </main>
      <MobileTabBar projectId={projectId!} />
    </div>
  )
}
// ── Hook for pages to access shell context ──
import { useOutletContext } from 'react-router-dom'
export interface ShellContext {
  project: Project | null
  projectId: string
  revalidate: () => void
}
export function useShell(): ShellContext {
  return useOutletContext<ShellContext>()
}
