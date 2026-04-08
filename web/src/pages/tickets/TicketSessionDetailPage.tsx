import { useLoaderData, useNavigate, useParams } from 'react-router-dom'
import { marked } from 'marked'
import type { Session, Execution } from '../../types.js'
import { InfoGroup } from '../../components/detail/InfoGroup.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'

interface SessionLoaderData {
  session: Session
  executions: Execution[]
}

export function TicketSessionDetailPage() {
  const { session, executions } = useLoaderData() as SessionLoaderData
  const { projectId } = useShell()
  const { ticketId, sessionId } = useParams()
  const navigate = useNavigate()

  const agentName = session.agent_name ?? session.agent_id

  useBreadcrumbLabel(agentName)

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agentName}</h2>

      <InfoGroup rows={[
        { label: 'status',   value: session.status },
        { label: 'model',    value: session.model },
        { label: 'started',  value: ts(session.started_at) },
        { label: 'duration', value: duration },
      ]} />

      {session.error && (
        <div className="space-y-1">
          <SectionLabel label="error" />
          <div className="prose-zinc text-sm px-4" dangerouslySetInnerHTML={{ __html: marked.parse(session.error) as string }} />
        </div>
      )}

      <div>
        <SectionLabel label={`executions (${executions.length})`} />
        {executions.length === 0
          ? <EmptyState message="no executions" />
          : executions.map(e => {
            const firstLine = e.command.split('\n')[0].slice(0, 60)
            return (
              <ListRow
                key={e.id}
                title={firstLine}
                status={e.status}
                mono
                onPress={() => navigate(`/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${e.id}`)}
              />
            )
          })
        }
      </div>
    </div>
  )
}
