import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLoaderData, useRevalidator } from 'react-router-dom'
import { User, Bot, Info } from 'lucide-react'
import { ticketApi, commentApi } from '../../api.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import type { Ticket, Agent, Comment } from '../../types.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

// ── Comments Section ──

function CommentsSection({ projectId, ticketId, comments }: { projectId: string; ticketId: string; comments: Comment[] }) {
  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div>
      <SectionLabel label={`comments (${comments.length})`} />
      <div>
        {comments.map(c => {
          const firstLine = c.body.split('\n')[0].slice(0, 80)
          return (
            <ActivityRow
              key={c.id}
              icon={c.author === 'founder' ? <User size={14} /> : c.author === 'system' ? <Info size={14} /> : <Bot size={14} />}
              label={firstLine}
              detailHref={c.session_id ? `/p/${projectId}/tickets/${ticketId}/sessions/${c.session_id}` : undefined}
              detailLabel="view session"
              status={c.author}
              meta={ts(c.created_at)}
              body={c.body}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Loader data shape ──

interface TicketLoaderData {
  ticket: Ticket
  agents: Agent[]
  comments: Comment[]
}

// ── Ticket Detail Page ──

export function TicketDetailPage() {
  const { projectId } = useShell()
  const { ticket, agents, comments: initialComments } = useLoaderData() as TicketLoaderData
  const { revalidate } = useRevalidator()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(ticket.body)
  const [comments, setComments] = useState(initialComments)

  useBreadcrumbLabel(ticket.title)

  useEffect(() => { setBody(ticket.body) }, [ticket.body])
  useEffect(() => { setComments(initialComments) }, [initialComments])

  const handleAddComment = useCallback(async (text: string) => {
    await commentApi.create(ticket.id, { author: 'founder', body: text })
    setComments(await commentApi.list(ticket.id))
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
    <DetailShell
      type="ticket" id={ticket.id} title={ticket.title} status={ticket.status}
      subtitle={!editing ? ticket.body : undefined}
      actions={!editing && ticket.status === 'open' ? (
        <button onClick={() => setEditing(true)}
          className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">
          edit
        </button>
      ) : undefined}
      infoRows={[
        { label: 'agent',    value: agentName },
        { label: 'creator',  value: ticket.created_by },
        { label: 'created',  value: ts(ticket.created_at) },
        { label: 'priority', value: ticket.priority > 0 ? String(ticket.priority) : null },
        { label: 'claimed',  value: ticket.claimed_at ? ts(ticket.claimed_at) : null },
        { label: 'updated',  value: ticket.updated_at !== ticket.created_at ? ts(ticket.updated_at) : null },
      ]}
      composer={{ placeholder: 'Comment', onSubmit: handleAddComment }}
    >
      {editing && (
        <div className="space-y-4">
          <Field label="body">
            <TextArea label="body" value={body} onChange={e => setBody(e.target.value)} rows={6} />
          </Field>
          <div className="flex gap-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" onClick={handleSave} className="flex-1" />
          </div>
        </div>
      )}

      <CommentsSection projectId={projectId} ticketId={ticket.id} comments={comments} />

      {!editing && (ticket.status === 'failed' || ticket.status === 'done') && (
        <div className="pt-2">
          <ActionButton label="reopen" variant="secondary" onClick={handleReopen} className="w-full" />
        </div>
      )}
    </DetailShell>
  )
}
