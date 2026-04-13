import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLoaderData, useRevalidator } from 'react-router-dom'
import { User, Bot, Info } from 'lucide-react'
import { ticketApi, commentApi, bustCache } from '../../api.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import type { Ticket, Agent, Comment, UsageRollup, TicketTag } from '../../types.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { fmtDuration, fmtBytes, fmtActor } from '../../lib/format.js'

// ── Tag Section ──

function TagSection({ ticketId, initialTags }: { ticketId: string; initialTags: TicketTag[] }) {
  const [tags, setTags] = useState(initialTags)
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTags(initialTags) }, [initialTags])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  async function refreshTags() {
    bustCache()
    setTags(await ticketApi.tags(ticketId))
  }

  async function handleRemove(tag: string) {
    await ticketApi.removeTag(ticketId, tag)
    await refreshTags()
  }

  async function commitAdd() {
    const val = value.trim().toLowerCase()
    setValue('')
    setAdding(false)
    if (!val) return
    await ticketApi.addTag(ticketId, val)
    await refreshTags()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); void commitAdd() }
    if (e.key === 'Escape') { setValue(''); setAdding(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map(t => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 font-mono px-1.5 py-px rounded-sm border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400"
        >
          {t.tag}
          <button
            onClick={() => void handleRemove(t.tag)}
            className="leading-none text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
            aria-label={`Remove tag ${t.tag}`}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => void commitAdd()}
          placeholder="tag name"
          className="text-xs bg-transparent border-b border-zinc-500 dark:border-zinc-600 focus:border-zinc-700 dark:focus:border-zinc-400 outline-none px-1 w-20 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 transition-colors"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors leading-none"
        >
          + tag
        </button>
      )}
    </div>
  )
}

// ── Comments Section ──

function CommentsSection({ projectId, ticketId, comments, onRefresh }: { projectId: string; ticketId: string; comments: Comment[]; onRefresh: () => Promise<void> }) {
  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div>
      <SectionLabel label={`comments (${comments.length})`} onRefresh={onRefresh} />
      <div>
        {comments.map(c => {
          const firstLine = c.body.split('\n')[0].slice(0, 80)
          return (
            <ActivityRow
              key={c.id}
              icon={c.author === 'founder' ? <User size={14} /> : c.author === 'system' ? <Info size={14} /> : <Bot size={14} />}
              label={firstLine}
              sub={c.session_id ? { to: `/p/${projectId}/tickets/${ticketId}/sessions/${c.session_id}`, label: 'view session' } : undefined}
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
  usage: UsageRollup
  tags: TicketTag[]
}

// ── Ticket Detail Page ──

export function TicketDetailPage() {
  const { projectId } = useShell()
  const { ticket, agents, comments: initialComments, usage, tags: initialTags } = useLoaderData() as TicketLoaderData
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

  const refreshComments = useCallback(async () => {
    bustCache()
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
        { label: 'creator',  value: fmtActor(ticket.created_by) },
        { label: 'created',  value: ts(ticket.created_at) },
        { label: 'priority', value: ticket.priority > 0 ? String(ticket.priority) : null },
        { label: 'claimed',  value: ticket.claimed_at ? ts(ticket.claimed_at) : null },
        { label: 'updated',  value: ticket.updated_at !== ticket.created_at ? ts(ticket.updated_at) : null },
        { label: 'sessions',   value: usage.session_count > 0 ? String(usage.session_count) : null },
        { label: 'tokens in',  value: usage.tokens_in  > 0 ? usage.tokens_in.toLocaleString()  : null },
        { label: 'tokens out', value: usage.tokens_out > 0 ? usage.tokens_out.toLocaleString() : null },
        { label: 'tool calls', value: usage.tool_calls > 0 ? String(usage.tool_calls)          : null },
        { label: 'cpu',      value: usage.cpu_ms > 0 ? fmtDuration(usage.cpu_ms) : null },
        { label: 'memory',   value: usage.peak_memory_mb !== null ? `${usage.peak_memory_mb.toFixed(0)} MB peak` : null },
        { label: 'network',  value: usage.net_bytes > 0 ? fmtBytes(usage.net_bytes) : null },
        { label: 'duration', value: usage.duration_ms > 0 ? fmtDuration(usage.duration_ms) : null },
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

      <TagSection ticketId={ticket.id} initialTags={initialTags} />

      <CommentsSection projectId={projectId} ticketId={ticket.id} comments={comments} onRefresh={refreshComments} />

      {!editing && (ticket.status === 'failed' || ticket.status === 'done') && (
        <div className="pt-2">
          <ActionButton label="reopen" variant="secondary" onClick={handleReopen} className="w-full" />
        </div>
      )}
    </DetailShell>
  )
}
