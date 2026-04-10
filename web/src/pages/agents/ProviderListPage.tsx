import { Link, useLoaderData } from 'react-router-dom'
import type { Provider } from '../../types.js'
import { useShell } from '../../Shell.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function ProviderListPage() {
  const { projectId, revalidate } = useShell()
  const providers = useLoaderData() as Provider[]

  return (
    <PageShell
      action={{ label: 'Provider', onPress: `/p/${projectId}/agents/providers/new` }}
      onRefresh={async () => { revalidate() }}
    >
      {providers.length === 0
        ? <EmptyState message="no providers configured" />
        : <div className="[&>:last-child>*]:border-b-0">{providers.map(p => (
          <Link key={p.id} to={`/p/${projectId}/agents/providers/${p.id}`} className="block">
            <ListRow title={p.name} subtitle={`${p.type} · ${p.api_key_preview}`} />
          </Link>
        ))}</div>
      }
    </PageShell>
  )
}
