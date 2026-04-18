import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLoaderData, useRevalidator, Link } from 'react-router-dom'
import { User, Bot, Info, Check, X, Clock, Zap, ChevronDown } from 'lucide-react'
import { ticketApi, commentApi, bustCache } from '../../api.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import type { Ticket, Agent, Comment, UsageRollup, Tag, Verdict, Session, Event } from '../../types.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { fmtDuration, fmtActor } from '../../lib/format.js'
import { marked } from 'marked'

// ── Collapsible section ──

function Section({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800/60">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-2.5 text-xs text-zinc-500 dark:text-zinc-400 active:text-zinc-700 dark:active:text-zinc-200 transition-colors"
      >
        <span className="font-medium">{title}{count > 0 ? ` (${count})` : ''}</span>
        <ChevronDown size={14} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

// ── Tag Section ──

function TagSection({ ticketId, initialTags }: { ticketId: string; initialTags: Tag[] }) {
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
        <span key={t.id} className="inline-flex items-center gap-1 font-mono px-1.5 py-px rounded-sm border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400">
          {t.tag}
          <button onClick={() => void handleRemove(t.tag)} className="leading-none text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors" aria-label={`Remove tag ${t.tag}`}>×</button>
        </span>
      ))}
      {adding ? (
        <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => void commitAdd()} placeholder="tag name"
          className="text-xs bg-transparent border-b border-zinc-500 dark:border-zinc-600 focus:border-zinc-700 dark:focus:border-zinc-400 outline-none px-1 w-20 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 transition-colors" />
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors leading-none">+ tag</button>
      )}
    </div>
  )
}

// ── Timeline: merge sessions, verdicts, events into one chronological stream ──

interface TimelineEntry {
  id: string
  time: string
  kind: 'session' | 'verdict' | 'event'
  icon: React.ReactNode
  label: string
  status?: string
  meta?: string
  body?: string
  link?: string
}

function buildTimeline(
  sessions: Session[], verdicts: Verdict[], events: Event[],
  agentNameById: (id: string) => string, projectId: string, ticketId: string,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const s of sessions as any[]) {
    entries.push({
      id: `s-${s.id}`,
      time: s.started_at,
      kind: 'session',
      icon: <Zap size={14} />,
      label: s.agent_name ?? agentNameById(s.agent_id),
      status: s.status,
      body: [s.duration_ms ? fmtDuration(s.duration_ms) : null, s.cost_usd ? `$${s.cost_usd.toFixed(4)}` : null, s.tool_calls ? `${s.tool_calls} tools` : null].filter(Boolean).join(' · ') || undefined,
      link: `/p/${projectId}/tickets/${ticketId}/sessions/${s.id}`,
    })
  }

  for (const v of verdicts) {
    entries.push({
      id: `v-${v.id}`,
      time: v.created_at,
      kind: 'verdict',
      icon: v.pass ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-red-500" />,
      label: agentNameById(v.agent_id),
      status: v.pass ? 'pass' : 'fail',
      body: v.reason,
    })
  }

  for (const e of events) {
    entries.push({
      id: `e-${e.id}`,
      time: e.created_at,
      kind: 'event',
      icon: <Clock size={14} className="text-zinc-500" />,
      label: e.kind.replace(/_/g, ' '),
      status: e.caused_by,
      body: e.data !== '{}' ? e.data : undefined,
    })
  }

  return entries.sort((a, b) => a.time.localeCompare(b.time))
}

// ── Loader ──

interface TicketLoaderData {
  ticket: Ticket; agents: Agent[]; comments: Comment[]; usage: UsageRollup
  tags: Tag[]; verdicts: Verdict[]; sessions: Session[]; chain: Ticket[]; events: Event[]
}

// ── Page ──

export function TicketDetailPage() {
  const { projectId } = useShell()
  const { ticket, agents, comments: initialComments, usage, tags: initialTags, verdicts, sessions, events } = useLoaderData() as TicketLoaderData
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

  const timeline = buildTimeline(sessions, verdicts, events, agentNameById, projectId, ticket.id)

  return (
    <DetailShell
      type="ticket" id={ticket.id} title={ticket.title}
      status={ticket.status}
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
      ]}
      composer={{ placeholder: 'Comment', onSubmit: handleAddComment }}
    >
      {/* ── Description ── */}
      <Section title="Description" count={0} defaultOpen={false}>
        <div className="space-y-4">
          {editing ? (
            <>
              <Field label="description">
                <TextArea label="description" value={description} onChange={e => setDescription(e.target.value)} rows={6} />
              </Field>
              <div className="flex gap-2">
                <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
                <ActionButton label="save" onClick={handleSave} className="flex-1" />
              </div>
            </>
          ) : (
            <div className="prose-zinc text-sm text-zinc-700 dark:text-zinc-400 max-w-full overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: marked.parse(ticket.description) as string }} />
          )}
          <TagSection ticketId={ticket.id} initialTags={initialTags} />
        </div>
      </Section>

      {/* ── Timeline ── */}
      <Section title="Timeline" count={timeline.length} defaultOpen={false}>
        {timeline.length === 0 && <p className="text-xs text-zinc-500">No activity yet.</p>}
        {timeline.map(e => {
          const row = (
            <ActivityRow
              key={e.id}
              icon={e.icon}
              label={e.label}
              status={e.status}
              meta={ts(e.time)}
              body={e.body}
            />
          )
          return e.link ? <Link key={e.id} to={e.link} className="block">{row}</Link> : <div key={e.id}>{row}</div>
        })}
      </Section>

      {/* ── Comments ── */}
      <Section title="Comments" count={comments.length} defaultOpen={false}>
        {comments.length === 0 && <p className="text-xs text-zinc-500">No comments yet.</p>}
        {comments.map(c => (
          <ActivityRow
            key={c.id}
            icon={c.author === 'founder' ? <User size={14} /> : c.author === 'system' ? <Info size={14} /> : <Bot size={14} />}
            label={c.body.split('\n')[0].slice(0, 80)}
            sub={c.session_id ? { to: `/p/${projectId}/tickets/${ticket.id}/sessions/${c.session_id}`, label: 'session' } : undefined}
            status={c.author}
            meta={ts(c.created_at)}
            body={c.body}
          />
        ))}
      </Section>

      {/* ── Cancel ── */}
      {!editing && ticket.status !== 'finished' && ticket.status !== 'cancelled' && (
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/60">
          <ActionButton label="cancel ticket" variant="destructive" onClick={handleCancel} className="w-full" />
        </div>
      )}
    </DetailShell>
  )
}
