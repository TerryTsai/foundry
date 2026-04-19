import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { projectListOpts, qk } from '../../queries.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ProjectListPage() {
  const { data: projects, isPending } = useQuery(projectListOpts())
  const queryClient = useQueryClient()

  return (
    <PageShell
      action={{ label: 'Project', onPress: '/settings/projects/new' }}
      onRefresh={async () => { await queryClient.invalidateQueries({ queryKey: qk.project.all() }) }}
    >
      {isPending ? null
        : !projects || projects.length === 0
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
