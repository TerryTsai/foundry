import { Link, useLoaderData, useRevalidator } from 'react-router-dom'
import type { Project } from '../../types.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ProjectListPage() {
  const projects = useLoaderData() as Project[]
  const { revalidate } = useRevalidator()

  return (
    <div className="h-dvh flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2.5 px-4 h-12 shrink-0 border-b border-zinc-200 dark:border-zinc-800/60">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
          <path d="M10 1 L19 10 L10 19 L1 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M10 5.5 L14.5 10 L10 14.5 L5.5 10 Z" fill="currentColor" />
        </svg>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Foundry</span>
      </div>
      <div className="flex-1 min-h-0">
        <PageShell action={{ label: 'Project', onPress: '/projects/new' }} onRefresh={async () => { revalidate() }}>
          {projects.length === 0
            ? <EmptyState message="no projects" />
            : projects.map(p => (
              <Link key={p.id} to={`/p/${p.id}/tickets`} className="block">
                <ListRow
                  title={p.name}
                  subtitle={`${p.max_agents} ${p.max_agents === 1 ? 'agent' : 'agents'}`}
                />
              </Link>
            ))
          }
        </PageShell>
      </div>
    </div>
  )
}
