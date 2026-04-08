import { Link, useLoaderData, useParams } from 'react-router-dom'
import type { Session } from '../../types.js'
import { useShell } from '../../Shell.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

export function TicketSessionsPage() {
  const { projectId } = useShell()
  const { ticketId } = useParams<{ ticketId: string }>()
  const sessions = useLoaderData() as Session[]

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
      {sessions.length === 0
        ? <EmptyState message="no sessions" />
        : sessions.map(s => (
          <Link key={s.id} to={`/p/${projectId}/tickets/${ticketId}/sessions/${s.id}`} className="block">
            <ListRow
              title={s.agent_name ?? s.agent_id}
              subtitle={ts(s.started_at)}
              status={s.status}
            />
          </Link>
        ))
      }
    </div>
  )
}
