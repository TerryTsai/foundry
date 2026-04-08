import { Link, useLoaderData } from 'react-router-dom'
import type { Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function AgentListPage() {
  const { projectId, revalidate } = useShell()
  const agents = useLoaderData() as Agent[]

  return (
    <PageShell
      action={{ label: 'Agent', onPress: `/p/${projectId}/agents/new` }}
      onRefresh={async () => { revalidate() }}
    >
      <Link to={`/p/${projectId}/agents/providers`} className="block">
        <ListRow title="Providers" subtitle="API keys and model access" />
      </Link>
      {agents.length === 0
        ? <EmptyState message="no agents" />
        : agents.map(a => (
          <Link key={a.id} to={`/p/${projectId}/agents/${a.id}`} className="block">
            <ListRow title={a.name} subtitle={a.model} />
          </Link>
        ))
      }
    </PageShell>
  )
}
