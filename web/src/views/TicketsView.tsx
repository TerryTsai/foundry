import { useState, useEffect, useCallback } from 'react'
import { ticketApi, agentApi } from '../api.js'
import type { Ticket, AgentDef } from '../types.js'
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
  onSave,
  onCancel,
}: {
  projectId: string
  onSave: () => void
  onCancel: () => void
}) {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agent, setAgent] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    agentApi.list(projectId).then(as => {
      setAgents(as)
      setAgent(as[0]?.name ?? '')
    }).catch(console.error)
  }, [projectId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await ticketApi.create({ project_id: projectId, title, body, agent, created_by: 'founder' })
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
          <Select value={agent} onChange={e => setAgent(e.target.value)} required>
            {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            {agents.length === 0 && <option value="">no agents in project</option>}
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
        <ActionButton label="create" type="submit" disabled={!agent} className="flex-1" />
      </div>
    </form>
  )
}

function TicketDetail({
  ticket,
  onClose,
  onUpdate,
}: {
  ticket: Ticket
  onClose: () => void
  onUpdate: () => void
}) {
  const [chain, setChain] = useState<Ticket[]>([])
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(ticket.body)
  const [notes, setNotes] = useState(ticket.notes ?? '')

  useEffect(() => {
    ticketApi.chain(ticket.id).then(setChain).catch(console.error)
  }, [ticket.id])

  async function handleSave() {
    await ticketApi.update(ticket.id, { body, notes: notes || undefined })
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
          { label: 'agent',   value: ticket.agent },
          { label: 'created', value: ts(ticket.created_at) },
          { label: 'claimed', value: ticket.claimed_at ? ts(ticket.claimed_at) : null },
          { label: 'parent',  value: ticket.parent_id ?? null },
        ]} />

        {editing ? (
          <div className="space-y-4">
            <Field label="body">
              <TextArea label="body" value={body} onChange={e => setBody(e.target.value)} rows={6} />
            </Field>
            <Field label="notes">
              <TextArea label="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="optional notes" />
            </Field>
          </div>
        ) : (
          <>
            <div className="bg-zinc-100 dark:bg-zinc-900 p-3 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
              {ticket.body}
            </div>
            {ticket.notes && (
              <div className="space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">notes</div>
                <div className="bg-zinc-100 dark:bg-zinc-900 p-3 text-sm text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed font-sans">
                  {ticket.notes}
                </div>
              </div>
            )}
          </>
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
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const [createdFilter, setCreatedFilter] = useState<Set<string>>(new Set())
  const [claimedFilter, setClaimedFilter] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const ts = await ticketApi.list({ projectId })
    setTickets(ts)
    setLoading(false)
  }, [projectId])

  useEffect(() => { load().catch(console.error) }, [load])

  const fmt = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const uniqueAgents = Array.from(new Set(tickets.map(t => t.agent))).sort()

  const filtered = tickets.filter(t => {
    if (statuses.size > 0 && !statuses.has(t.status)) return false
    if (agentFilter.size > 0 && !agentFilter.has(t.agent)) return false
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
        {/* Filter bar — outside scroll container so dropdowns aren't clipped */}
        <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto no-scrollbar">
          <MultiSelect
            label="Status"
            options={[...STATUSES]}
            selected={statuses}
            onChange={setStatuses}
          />
          {uniqueAgents.length > 0 && (
            <MultiSelect
              label="Agent"
              options={uniqueAgents}
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

        <PageShell
          action={noSheetOpen ? { label: 'Ticket', onPress: () => setShowCreate(true) } : undefined}
          onRefresh={load}
        >
        {loading ? (
          <EmptyState message="loading…" />
        ) : filtered.length === 0 ? (
          <EmptyState message="no tickets" />
        ) : filtered.map(t => (
          <ListRow
            key={t.id}
            title={t.title}
            subtitle={[t.agent, t.parent_id ? '↳ child' : '', fmt(t.created_at)].filter(Boolean).join(' · ')}
            status={t.status}
            onPress={() => setSelected(t)}
          />
        ))}
        </PageShell>
      </div>

      <Sheet open={showCreate} onClose={() => setShowCreate(false)} title="New Ticket">
        <TicketForm
          projectId={projectId}
          onSave={() => { setShowCreate(false); load().catch(console.error) }}
          onCancel={() => setShowCreate(false)}
        />
      </Sheet>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Ticket">
        {selected && (
          <TicketDetail
            ticket={selected}
            onClose={() => setSelected(null)}
            onUpdate={() => { load().catch(console.error); setSelected(null) }}
          />
        )}
      </Sheet>
    </>
  )
}
