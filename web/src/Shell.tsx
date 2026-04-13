import { Outlet, ScrollRestoration, useParams, useLoaderData, useRevalidator, NavLink } from 'react-router-dom'
import { Ticket, BarChart3, type LucideIcon } from 'lucide-react'
import type { Project } from './types.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
import { AppHeader } from './components/layout/AppHeader.js'

// Re-export for consumers that import FoundryMark from Shell
export { FoundryMark } from './components/layout/AppHeader.js'

// ── Nav items ──
export const navItems: Array<{ to: string; label: string; Icon: LucideIcon }> = [
  { to: 'tickets',   label: 'Tickets',   Icon: Ticket },
  { to: 'analytics', label: 'Analytics', Icon: BarChart3 },
]

// ── Shell ──
export function Shell() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useLoaderData() as Project
  const { revalidate } = useRevalidator()

  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-zinc-950">
      <AppHeader><ProjectSwitcher current={project} projectId={projectId!} /></AppHeader>

      {/* Tab nav — one strip for all project sections */}
      <nav className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 px-4 gap-1">
        {navItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={`/p/${projectId}/${to}`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-2 py-2.5 text-xs border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-amber-400 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`
            }
          >
            <Icon size={13} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>

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
