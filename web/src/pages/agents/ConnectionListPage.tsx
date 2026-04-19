import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionListOpts, qk } from '../../queries.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ConnectionListPage() {
  const { data: connections = [] } = useQuery(connectionListOpts())
  const queryClient = useQueryClient()

  return (
    <PageShell
      action={{ label: 'Connection', onPress: '/settings/connections/new' }}
      onRefresh={async () => { await queryClient.invalidateQueries({ queryKey: qk.connection.all() }) }}
    >
      {connections.length === 0
        ? <EmptyState message="no connections configured" />
        : <div className="[&>:last-child>*]:border-b-0">{connections.map(c => (
          <Link key={c.id} to={`/settings/connections/${c.id}`} className="block">
            <ListRow title={c.name} subtitle={`${c.kind}${c.api_key_preview ? ` · ${c.api_key_preview}` : ''}`} />
          </Link>
        ))}</div>
      }
    </PageShell>
  )
}
