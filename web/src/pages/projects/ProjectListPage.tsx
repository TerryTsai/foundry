import { Link, useLoaderData, useRevalidator } from 'react-router-dom'
import type { Project } from '../../types.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ProjectListPage() {
  const projects = useLoaderData() as Project[]
  const { revalidate } = useRevalidator()

  return (
    <PageShell
      action={{ label: 'Project', onPress: '/settings/projects/new' }}
      onRefresh={async () => { revalidate() }}
    >
      {projects.length === 0
        ? <EmptyState message="no projects" />
        : <div className="[&>:last-child>*]:border-b-0">{projects.map(p => (
          <Link key={p.id} to={`/p/${p.id}/tickets`} className="block">
            <ListRow
              title={p.name}
              subtitle={`${p.max_agents} ${p.max_agents === 1 ? 'agent' : 'agents'}`}
            />
          </Link>
        ))}</div>
      }
    </PageShell>
  )
}
