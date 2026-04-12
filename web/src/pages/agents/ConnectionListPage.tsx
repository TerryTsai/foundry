import { Link, useLoaderData, useRevalidator } from 'react-router-dom'
import type { Connection } from '../../types.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ConnectionListPage() {
  const { revalidate } = useRevalidator()
  const connections = useLoaderData() as Connection[]

  return (
    <PageShell
      action={{ label: 'Connection', onPress: '/settings/connections/new' }}
      onRefresh={async () => { revalidate() }}
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
