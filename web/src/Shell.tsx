import { Outlet, ScrollRestoration, useParams, useLoaderData, useRevalidator, Link } from 'react-router-dom'
import { Ticket, type LucideIcon } from 'lucide-react'
import { projectApi } from './api.js'
import type { Project } from './types.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
import { AvatarMenu } from './components/AvatarMenu.js'

// ── Foundry Mark ──
export function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
      <path d="M10 1 L19 10 L10 19 L1 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 5.5 L14.5 10 L10 14.5 L5.5 10 Z" fill="currentColor" />
    </svg>
  )
}

// ── Nav items (desktop sidebar / breadcrumb handles mobile) ──
export const navItems: Array<{ to: string; label: string; Icon: LucideIcon }> = [
  { to: 'tickets', label: 'Tickets', Icon: Ticket },
]

// ── Unified App Header ──
function AppHeader({
  projectId,
  project,
  onToggle,
}: {
  projectId: string
  project: Project | null
  onToggle: () => Promise<void>
}) {
  return (
    <header className="flex items-center h-12 shrink-0 px-4 gap-3 border-b border-zinc-300 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
      <Link to="/" className="flex items-center gap-2.5 shrink-0 mr-1">
        <FoundryMark />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-display">Foundry</span>
      </Link>
      <span className="text-zinc-300 dark:text-zinc-700 text-sm select-none">/</span>
      <ProjectSwitcher
        current={project}
        projectId={projectId}
        className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-1 min-w-0 truncate"
      />
      <AvatarMenu project={project} onToggle={onToggle} />
    </header>
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
      <AppHeader projectId={projectId!} project={project} onToggle={handleToggle} />
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
