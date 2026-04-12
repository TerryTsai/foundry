import { Outlet, ScrollRestoration, useParams, useLoaderData, useRevalidator } from 'react-router-dom'
import { Ticket, type LucideIcon } from 'lucide-react'
import type { Project } from './types.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
import { AppHeader } from './components/layout/AppHeader.js'

// Re-export for consumers that import FoundryMark from Shell
export { FoundryMark } from './components/layout/AppHeader.js'

// ── Nav items (desktop sidebar / breadcrumb handles mobile) ──
export const navItems: Array<{ to: string; label: string; Icon: LucideIcon }> = [
  { to: 'tickets', label: 'Tickets', Icon: Ticket },
]

// ── Shell ──
export function Shell() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useLoaderData() as Project
  const { revalidate } = useRevalidator()

  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-zinc-950">
      <AppHeader><ProjectSwitcher current={project} projectId={projectId!} /></AppHeader>
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
