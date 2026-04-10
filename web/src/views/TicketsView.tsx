import { useState, useEffect, useCallback } from 'react'
import { ticketApi, agentApi, commentApi, sessionApi } from '../api.js'
import type { Ticket, Agent, Comment, Session, Execution } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'
import { PageShell } from '../components/layout/PageShell.js'
import { MultiSelect } from '../components/primitives/MultiSelect.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { InfoGroup } from '../components/detail/InfoGroup.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { TextArea } from '../components/form/TextArea.js'
import { Select } from '../components/form/Select.js'
import { ActionButton } from '../components/form/ActionButton.js'

const STATUSES = ['open', 'claimed', 'done', 'failed', 'blocked']

const DATE_OPTIONS = ['today', 'yesterday', 'this week', 'this month']

function matchesDateFilter(iso: string, selected: Set<string>): boolean {
  const d = new Date(iso)
  const now = new Date()
  const startOf = (unit: 'day' | 'week' | 'month') => {
    const s = new Date(now)
    if (unit === 'day')   { s.setHours(0, 0, 0, 0) }
    if (unit === 'week')  { s.setHours(0, 0, 0, 0); s.setDate(now.getDate() - now.getDay()) }
    if (unit === 'month') { s.setHours(0, 0, 0, 0); s.setDate(1) }
    return s
  }
  const yesterday = new Date(startOf('day')); yesterday.setDate(yesterday.getDate() - 1)
  const endOfYesterday = new Date(startOf('day'))

  return (
    (selected.has('today')      && d >= startOf('day')) ||
    (selected.has('yesterday')  && d >= yesterday && d < endOfYesterday) ||
    (selected.has('this week')  && d >= startOf('week')) ||
    (selected.has('this month') && d >= startOf('month'))
  )
}

function TicketForm({
  projectId,
  agents,
  onSave,
  onCancel,
}: {
  projectId: string
  agents: Agent[]
  onSave: () => void
  onCancel: () => void
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await ticketApi.create({ project_id: projectId, title, body, agent_id: agentId || undefined, created_by: 'founder' })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="agent">
          <Select value={agentId} onChange={e => setAgentId(e.target.value)}>
            <option value="">unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="title">
          <TextInput value={title} onChange={e => setTitle(e.target.value)} required />
        </Field>
        <Field label="description">
          <TextArea label="description" value={body} onChange={e => setBody(e.target.value)} required rows={5} />
        </Field>
      </div>
      <div className="shrink-0 pt-3 flex gap-2">
        <ActionButton label="cancel" variant="secondary" onClick={onCancel} className="flex-1" />
        <ActionButton label="create" type="submit" className="flex-1" />
      </div>
    </form>
  )
}

function CommentsSection({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [body, setBody] = useState('')

  const load = useCallback(() => {
    commentApi.list(ticketId).then(setComments).catch(console.error)
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    await commentApi.create(ticketId, { author: 'founder', body })
    setBody('')
    load()
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
        comments ({comments.length})
      </div>
      {comments.map(c => (
        <div key={c.id} className="bg-zinc-100 dark:bg-zinc-900 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{c.author}</span>
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
              {new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{c.body}</div>
        </div>
      ))}
      <form onSubmit={handleAdd} className="flex gap-2">
        <TextInput value={body} onChange={e => setBody(e.target.value)} placeholder="add a comment…" className="flex-1" />
        <ActionButton label="add" type="submit" disabled={!body.trim()} />
      </form>
    </div>
  )
}

function ExecutionRow({ execution }: { execution: Execution }) {
  const duration = execution.duration_ms !== null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : null
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <StatusBadge status={execution.status} />
        {duration && <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{duration}</span>}
        {execution.exit_code !== null && (
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">exit {execution.exit_code}</span>
        )}
      </div>
      <pre className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all leading-relaxed">{execution.command}</pre>
    </div>
  )
}

function SessionRow({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const [executions, setExecutions] = useState<Execution[]>([])

  useEffect(() => {
    if (expanded) {
      sessionApi.executions(session.id).then(setExecutions).catch(console.error)
    }
  }, [expanded, session.id])

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null

  return (
    <div className="border border-zinc-200 dark:border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2.5 flex items-center gap-2 active:bg-zinc-50 dark:active:bg-zinc-900 transition-colors"
      >
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0">{expanded ? '▼' : '▶'}</span>
        <StatusBadge status={session.status} />
        <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{session.agent_name ?? session.agent_id}</span>
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 ml-auto shrink-0">{ts(session.started_at)}</span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800/60 px-3 py-2.5 space-y-2">
          <InfoGroup rows={[
            { label: 'model',      value: session.model },
            { label: 'duration',   value: duration },
            { label: 'tokens in',  value: session.tokens_in  !== null ? session.tokens_in.toLocaleString()  : null },
            { label: 'tokens out', value: session.tokens_out !== null ? session.tokens_out.toLocaleString() : null },
            { label: 'tool calls', value: session.tool_calls !== null ? String(session.tool_calls)          : null },
            { label: 'cost',       value: session.cost_usd   !== null ? `$${session.cost_usd.toFixed(4)}`   : null },
          ]} />
          {session.error && (
            <pre className="bg-red-50 dark:bg-red-950/30 p-2.5 font-mono text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap leading-relaxed">{session.error}</pre>
          )}
          {executions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                executions ({executions.length})
              </div>
              {executions.map(e => <ExecutionRow key={e.id} execution={e} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionsSection({ ticketId }: { ticketId: string }) {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    sessionApi.byTicket(ticketId).then(setSessions).catch(console.error)
  }, [ticketId])

  if (sessions.length === 0) return null

  return (
    <div className="space-y-2 pt-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
        sessions ({sessions.length})
      </div>
      {sessions.map(s => <SessionRow key={s.id} session={s} />)}
    </div>
  )
}

function TicketDetail({
  ticket,
  agents,
  onClose,
  onUpdate,
}: {
  ticket: Ticket
  agents: Agent[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [chain, setChain] = useState<Ticket[]>([])
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(ticket.body)

  const agentName = agents.find(a => a.id === ticket.agent_id)?.name ?? ticket.agent_id ?? 'unassigned'

  useEffect(() => {
    ticketApi.chain(ticket.id).then(setChain).catch(console.error)
  }, [ticket.id])

  async function handleSave() {
    await ticketApi.update(ticket.id, { body })
    setEditing(false)
    onUpdate()
  }

  async function handleReopen() {
    await ticketApi.reopen(ticket.id)
    onUpdate(); onClose()
  }

  const ts = (s: string) => new Date(s).toLocaleString()

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={ticket.status} />
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100">
              edit
            </button>
          )}
        </div>

        <InfoGroup rows={[
          { label: 'agent',    value: agentName },
          { label: 'priority', value: String(ticket.priority) },
          { label: 'created',  value: ts(ticket.created_at) },
          { label: 'claimed',  value: ticket.claimed_at ? ts(ticket.claimed_at) : null },
          { label: 'parent',   value: ticket.parent_id ?? null },
        ]} />

        {editing ? (
          <div className="space-y-4">
            <Field label="body">
              <TextArea label="body" value={body} onChange={e => setBody(e.target.value)} rows={6} />
            </Field>
          </div>
        ) : (
          <div className="bg-zinc-100 dark:bg-zinc-900 p-3 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
            {ticket.body}
          </div>
        )}

        {chain.length > 1 && (
          <div className="space-y-1.5 pt-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">chain ({chain.length})</div>
            {chain.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 font-mono text-xs py-1 border-b border-zinc-100 dark:border-zinc-800/50">
                <span className="text-zinc-400 dark:text-zinc-700 shrink-0">{i === chain.length - 1 ? '→' : '·'}</span>
                <span className="text-zinc-500 dark:text-zinc-400 truncate">{t.title}</span>
                <div className="shrink-0 ml-auto"><StatusBadge status={t.status} /></div>
              </div>
            ))}
          </div>
        )}

        <SessionsSection ticketId={ticket.id} />
        <CommentsSection ticketId={ticket.id} />
      </div>

      {editing && (
        <div className="shrink-0 pt-3 flex gap-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
          <ActionButton label="save" onClick={handleSave} className="flex-1" />
        </div>
      )}
      {!editing && ticket.status === 'failed' && (
        <div className="shrink-0 pt-3">
          <ActionButton label="reopen" variant="secondary" onClick={handleReopen} className="w-full" />
        </div>
      )}
    </div>
  )
}

export function TicketsView({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const [createdFilter, setCreatedFilter] = useState<Set<string>>(new Set())
  const [claimedFilter, setClaimedFilter] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [ts, as] = await Promise.all([
      ticketApi.list({ projectId }),
      agentApi.list(projectId),
    ])
    setTickets(ts)
    setAgents(as)
    setLoading(false)
  }, [projectId])

  useEffect(() => { load().catch(console.error) }, [load])

  const fmt = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const agentName = (t: Ticket) => agents.find(a => a.id === t.agent_id)?.name ?? 'unassigned'
  const uniqueAgentNames = Array.from(new Set(tickets.map(agentName))).sort()

  const filtered = tickets.filter(t => {
    if (statuses.size > 0 && !statuses.has(t.status)) return false
    if (agentFilter.size > 0 && !agentFilter.has(agentName(t))) return false
    if (createdFilter.size > 0 && !matchesDateFilter(t.created_at, createdFilter)) return false
    if (claimedFilter.size > 0) {
      if (claimedFilter.has('unclaimed') && !t.claimed_at) return true
      if (!t.claimed_at) return claimedFilter.has('unclaimed')
      if (!matchesDateFilter(t.claimed_at, claimedFilter)) return false
    }
    return true
  })

  const noSheetOpen = !selected && !showCreate

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Filter bar */}
        <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto no-scrollbar">
          <MultiSelect
            label="Status"
            options={[...STATUSES]}
            selected={statuses}
            onChange={setStatuses}
          />
          {uniqueAgentNames.length > 0 && (
            <MultiSelect
              label="Agent"
              options={uniqueAgentNames}
              selected={agentFilter}
              onChange={setAgentFilter}
            />
          )}
          <MultiSelect
            label="Created"
            options={DATE_OPTIONS}
            selected={createdFilter}
            onChange={setCreatedFilter}
          />
          <MultiSelect
            label="Claimed"
            options={['unclaimed', ...DATE_OPTIONS]}
            selected={claimedFilter}
            onChange={setClaimedFilter}
          />
        </div>

        <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
          {/* List column */}
          <div className="h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60 lg:overflow-y-auto">
            <PageShell
              action={noSheetOpen ? { label: 'Ticket', onPress: () => setShowCreate(true) } : undefined}
              onRefresh={load}
            >
            {loading ? (
              <EmptyState message="loading..." />
            ) : filtered.length === 0 ? (
              <EmptyState message="no tickets" />
            ) : <div className="[&>:last-child]:border-b-0">{filtered.map(t => (
              <ListRow
                key={t.id}
                title={t.title}
                subtitle={fmt(t.created_at)}
                status={t.status}
                active={selected?.id === t.id}
                onPress={() => setSelected(t)}
              />
            ))}</div>}
            </PageShell>
          </div>

          {/* Detail column — desktop only */}
          <div className="hidden lg:flex flex-col overflow-y-auto">
            {selected ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{selected.title}</h2>
                </div>
                <TicketDetail
                  ticket={selected}
                  agents={agents}
                  onClose={() => setSelected(null)}
                  onUpdate={() => { load().catch(console.error); setSelected(null) }}
                />
              </div>
            ) : (
              <EmptyState message="select a ticket" />
            )}
          </div>
        </div>
      </div>

      <Sheet open={showCreate} onClose={() => setShowCreate(false)} title="New Ticket">
        <TicketForm
          projectId={projectId}
          agents={agents}
          onSave={() => { setShowCreate(false); load().catch(console.error) }}
          onCancel={() => setShowCreate(false)}
        />
      </Sheet>

      {/* Detail sheet — mobile only */}
      <div className="lg:hidden">
        <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Ticket">
          {selected && (
            <TicketDetail
              ticket={selected}
              agents={agents}
              onClose={() => setSelected(null)}
              onUpdate={() => { load().catch(console.error); setSelected(null) }}
            />
          )}
        </Sheet>
      </div>
    </>
  )
}
