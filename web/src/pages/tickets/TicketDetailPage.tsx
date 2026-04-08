import { useState, useEffect } from 'react'
import { useNavigate, useLoaderData, useRevalidator, Link } from 'react-router-dom'
import { marked } from 'marked'
import { ticketApi, commentApi, sessionApi } from '../../api.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import type { Ticket, Agent, Comment } from '../../types.js'
import { useShell } from '../../Shell.js'
import { InfoGroup } from '../../components/detail/InfoGroup.js'
import { ListRow } from '../../components/list/ListRow.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

// ── Comments Section ──

function CommentsSection({ projectId, ticketId, initial }: { projectId: string; ticketId: string; initial: Comment[] }) {
  const [comments, setComments] = useState(initial)
  const [body, setBody] = useState('')

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    await commentApi.create(ticketId, { author: 'founder', body })
    setBody('')
    setComments(await commentApi.list(ticketId))
  }

  return (
    <div>
      <SectionLabel label={`comments (${comments.length})`} />
      {comments.map(c => {
        const firstLine = c.body.split('\n')[0].slice(0, 80)
        return (
          <ActivityRow
            key={c.id}
            label={firstLine}
            labelHref={c.session_id ? `/p/${projectId}/tickets/${ticketId}/sessions/${c.session_id}` : undefined}
            status={c.author === 'founder' ? 'founder' : 'agent'}
            meta={`${c.author} · ${ts(c.created_at)}`}
            body={c.body}
          />
        )
      })}
      <form onSubmit={handleAdd} className="flex gap-2 px-4 pt-2">
        <TextInput value={body} onChange={e => setBody(e.target.value)} placeholder="add a comment..." className="flex-1" />
        <ActionButton label="add" type="submit" disabled={!body.trim()} />
      </form>
    </div>
  )
}

// ── Loader data shape ──

interface TicketLoaderData {
  ticket: Ticket
  agents: Agent[]
  comments: Comment[]
  chain: Ticket[]
}

// ── Ticket Detail Page ──

export function TicketDetailPage() {
  const { projectId } = useShell()
  const { ticket, agents, comments, chain } = useLoaderData() as TicketLoaderData
  const { revalidate } = useRevalidator()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(ticket.body)
  const [sessionCount, setSessionCount] = useState<number | null>(null)

  useBreadcrumbLabel(ticket.title)

  useEffect(() => { setBody(ticket.body) }, [ticket.body])

  useEffect(() => {
    sessionApi.byTicket(ticket.id).then(s => setSessionCount(s.length)).catch(console.error)
  }, [ticket.id])

  const agentName = agents.find(a => a.id === ticket.agent_id)?.name ?? ticket.agent_id ?? 'unassigned'

  async function handleSave() {
    await ticketApi.update(ticket.id, { body })
    setEditing(false)
    revalidate()
  }

  async function handleReopen() {
    await ticketApi.reopen(ticket.id)
    navigate(`/p/${projectId}/tickets`)
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{ticket.title}</h2>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">
            edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <Field label="body">
            <TextArea label="body" value={body} onChange={e => setBody(e.target.value)} rows={6} />
          </Field>
          <div className="flex gap-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" onClick={handleSave} className="flex-1" />
          </div>
        </div>
      ) : (
        <div className="prose-zinc text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(ticket.body) as string }} />
      )}

      <InfoGroup rows={[
        { label: 'status',   value: ticket.status },
        { label: 'agent',    value: agentName },
        { label: 'created',  value: ts(ticket.created_at) },
        { label: 'priority', value: ticket.priority > 0 ? String(ticket.priority) : null },
        ...(sessionCount !== null && sessionCount > 0
          ? [{ label: 'sessions', value: sessionCount, href: `/p/${projectId}/tickets/${ticket.id}/sessions` }]
          : []),
      ]} />

      <CommentsSection projectId={projectId} ticketId={ticket.id} initial={comments} />

      {chain.length > 1 && (
        <div>
          <SectionLabel label={`chain (${chain.length})`} />
          {chain.map(t => (
            <Link key={t.id} to={`/p/${projectId}/tickets/${t.id}`} className="block">
              <ListRow title={t.title} status={t.status} active={t.id === ticket.id} />
            </Link>
          ))}
        </div>
      )}

      {!editing && ticket.status === 'failed' && (
        <div className="pt-2">
          <ActionButton label="reopen" variant="secondary" onClick={handleReopen} className="w-full" />
        </div>
      )}
    </div>
  )
}
