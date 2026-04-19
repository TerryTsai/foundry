import { Outlet, ScrollRestoration, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectGetOpts } from './queries.js'
import { queryClient } from './queryClient.js'
import { qk } from './queries.js'
import type { Project } from './types.js'
import { ProjectSwitcher } from './components/ProjectSwitcher.js'
import { AppHeader } from './components/layout/AppHeader.js'

// Re-export for consumers that import FoundryMark from Shell
export { FoundryMark } from './components/layout/AppHeader.js'

// ── Shell ──
// Project-scoped layout. The founder's day-to-day surface is the ticket
// list; header only, no secondary navigation. Account-level views
// (analytics, settings) live in the avatar menu, out of the way.
export function Shell() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useQuery(projectGetOpts(projectId!))
  // Broad refresh used by pull-to-refresh and onRefresh handlers.
  // Invalidating the root 'ticket' key re-runs every ticket-scoped query.
  const revalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.ticket.all() })
  }

  return (
    <div className="bg-white dark:bg-zinc-950 min-h-dvh">
      <AppHeader><ProjectSwitcher current={project ?? null} projectId={projectId!} /></AppHeader>
      <ScrollRestoration />
      <main className="min-w-0">
        <Outlet context={{ project: project ?? null, projectId: projectId!, revalidate }} />
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
