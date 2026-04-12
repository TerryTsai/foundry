import { useState, useRef } from 'react'
import { Outlet, NavLink, ScrollRestoration, useParams, useLoaderData, useRevalidator, Link } from 'react-router-dom'
import { Ticket, Pause, Play, Sun, Moon, Monitor, Settings, LogOut, type LucideIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { projectApi, authApi } from './api.js'
import type { Project, Account } from './types.js'
import { useTheme, type ThemeMode } from './theme.js'
import { MobileBreadcrumb } from './Breadcrumb.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
// ── Foundry Mark ──
export function FoundryMark() {
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
]
const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark']
// ── Avatar / account menu ──
function AvatarMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setOpen(true)
    // Lazy-fetch account on first open
    if (!account) authApi.me().then(setAccount).catch(console.error)
  }

  async function handleLogout() {
    setOpen(false)
    await authApi.logout()
    location.assign('/login')
  }

  const initials = account?.login?.[0]?.toUpperCase() ?? '·'

  const dropdown = open && pos && createPortal(
    <>
      <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      <div
        style={{ position: 'fixed', top: pos.top, right: pos.right, width: 168, zIndex: 9999 }}
        className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 rounded-lg shadow-xl py-1"
      >
        {account && (
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{account.name ?? account.login}</div>
            <div className="text-[10px] text-zinc-500 truncate">{account.login}</div>
          </div>
        )}
        <Link
          to="/settings"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <Settings size={12} strokeWidth={2} />
          Settings
        </Link>
        <button
          onClick={handleLogout}
          className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <LogOut size={12} strokeWidth={2} />
          Logout
        </button>
      </div>
    </>,
    document.body,
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Account"
        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        {account?.avatar_url ? (
          <img src={account.avatar_url} alt="" className="w-5 h-5 rounded-full" />
        ) : (
          <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] text-zinc-600 dark:text-zinc-300 flex items-center justify-center font-medium select-none">
            {initials}
          </span>
        )}
      </button>
      {dropdown}
    </>
  )
}
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
        <AvatarMenu />
      </div>
    </header>
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
        <AvatarMenu />
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
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
        <ScrollRestoration />
        <Outlet context={{ project, projectId: projectId!, revalidate }} />
      </main>
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
