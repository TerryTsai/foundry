import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLoaderData, useRevalidator } from 'react-router-dom'
import { User, Bot, Info, Zap, Eye } from 'lucide-react'
import { ticketApi, commentApi, bustCache } from '../../api.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import type { Ticket, Agent, Comment, UsageRollup, Verdict, Session } from '../../types.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { fmtDuration, fmtActor } from '../../lib/format.js'

// ── Tag Section ──

function TagSection({ ticketId, initialTags }: { ticketId: string; initialTags: string[] }) {
  const [tags, setTags] = useState(initialTags)
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTags(initialTags) }, [initialTags])
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

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
        <span key={t} className="inline-flex items-center gap-1 font-mono px-1.5 py-px rounded-sm border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400">
          {t}
          <button onClick={() => void handleRemove(t)} className="leading-none text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors" aria-label={`Remove tag ${t}`}>×</button>
        </span>
      ))}
      {adding ? (
        <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => void commitAdd()} placeholder="tag name"
          style={{ fontSize: '16px' }}
          className="bg-transparent border-b border-zinc-500 dark:border-zinc-600 focus:border-zinc-700 dark:focus:border-zinc-400 outline-none px-1 w-24 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 transition-colors" />
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center font-mono px-1.5 py-px rounded-sm border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">+ tag</button>
      )}
    </div>
  )
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Loader ──

interface TicketLoaderData {
  ticket: Ticket; agents: Agent[]; comments: Comment[]; usage: UsageRollup
  tags: string[]; verdicts: Verdict[]; sessions: Session[]; chain: Ticket[]
}

// ── Page ──

export function TicketDetailPage() {
  const { projectId } = useShell()
  const { ticket, agents, comments: initialComments, usage, tags: initialTags, verdicts, sessions } = useLoaderData() as TicketLoaderData
  const { revalidate } = useRevalidator()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(ticket.description)
  const [comments, setComments] = useState(initialComments)

  useBreadcrumbLabel(ticket.title)

  useEffect(() => { setDescription(ticket.description) }, [ticket.description])
  useEffect(() => { setComments(initialComments) }, [initialComments])

  const handleAddComment = useCallback(async (text: string) => {
    await commentApi.create(ticket.id, { author: 'founder', body: text })
    setComments(await commentApi.list(ticket.id))
  }, [ticket.id])

  const agentName = agents.find(a => a.id === ticket.agent_id)?.name ?? ticket.agent_id ?? 'unassigned'

  async function handleSave() {
    await ticketApi.update(ticket.id, { description })
    setEditing(false)
    revalidate()
  }

  async function handleCancel() {
    if (!confirm('Cancel this ticket?')) return
    await ticketApi.cancel(ticket.id)
    navigate(`/p/${projectId}/tickets`)
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const agentNameById = (id: string) => agents.find(a => a.id === id)?.name ?? id

  return (
    <DetailShell
      type="ticket" id={ticket.id} title={ticket.title}
      status={ticket.status}
      subtitle={!editing ? ticket.description : undefined}
      actions={!editing && ticket.status === 'created' && verdicts.length === 0 ? (
        <button onClick={() => setEditing(true)} className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">edit</button>
      ) : undefined}
      infoRows={[
        { label: 'agent',    value: agentName },
        { label: 'creator',  value: fmtActor(ticket.created_by) },
        { label: 'created',  value: ts(ticket.created_at) },
        { label: 'priority', value: ticket.priority > 0 ? String(ticket.priority) : null },
        { label: 'updated',  value: ticket.updated_at !== ticket.created_at ? ts(ticket.updated_at) : null },
        { label: 'sessions', value: usage.session_count > 0 ? String(usage.session_count) : null },
        { label: 'tools',    value: usage.tool_calls > 0 ? String(usage.tool_calls) : null },
        { label: 'duration', value: usage.duration_ms > 0 ? fmtDuration(usage.duration_ms) : null },
        { label: 'tags',     value: !editing ? <TagSection ticketId={ticket.id} initialTags={initialTags} /> : null },
      ]}
      composer={{ placeholder: 'Comment', onSubmit: handleAddComment }}
    >
      {editing && (
        <div className="space-y-4">
          <Field label="description">
            <TextArea label="description" value={description} onChange={e => setDescription(e.target.value)} rows={6} />
          </Field>
          <div className="flex gap-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" onClick={handleSave} className="flex-1" />
          </div>
        </div>
      )}

      <div>
        <SectionLabel label="sessions" />
        {sessions.length === 0 && <p className="text-xs text-zinc-500">No sessions yet.</p>}
        {sessions.map(s => {
          const isProducer = s.agent_id === ticket.agent_id
          const verdict = !isProducer ? verdicts.find(v => v.session_id === s.id) : undefined
          const verdictColor = verdict?.pass === true  ? 'text-emerald-500'
                             : verdict?.pass === false ? 'text-red-500'
                             : undefined
          return (
            <ActivityRow
              key={s.id}
              icon={isProducer ? <Zap size={14} /> : <Eye size={14} className={verdictColor} />}
              label={cap(s.agent_name ?? agentNameById(s.agent_id))}
              status={s.status}
              meta={ts(s.started_at)}
              sub={{ to: `/p/${projectId}/tickets/${ticket.id}/sessions/${s.id}`, label: 'session' }}
              expandable={false}
            />
          )
        })}
      </div>

      <div>
        <SectionLabel label="comments" />
        {comments.length === 0 && <p className="text-xs text-zinc-500">No comments yet.</p>}
        {comments.map(c => (
          <ActivityRow
            key={c.id}
            icon={c.author === 'founder' ? <User size={14} /> : c.author === 'system' ? <Info size={14} /> : <Bot size={14} />}
            label={c.body.split('\n')[0].slice(0, 80)}
            status={c.author}
            meta={ts(c.created_at)}
            body={c.body}
          />
        ))}
      </div>

      {!editing && ticket.status !== 'finished' && ticket.status !== 'cancelled' && (
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/60">
          <ActionButton label="cancel ticket" variant="destructive" onClick={handleCancel} className="w-full" />
        </div>
      )}
    </DetailShell>
  )
}
