import { useState, useEffect, useCallback } from 'react'
import { ticketApi, agentApi } from '../api.js'
import type { Ticket, AgentDef } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'
import { PageShell } from '../components/layout/PageShell.js'
import { FilterChip } from '../components/primitives/FilterChip.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { InfoGroup } from '../components/detail/InfoGroup.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { TextArea } from '../components/form/TextArea.js'
import { Select } from '../components/form/Select.js'
import { ActionButton } from '../components/form/ActionButton.js'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
]

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
          <TextArea value={body} onChange={e => setBody(e.target.value)} required rows={5} />
        </Field>
      </div>
      <div className="shrink-0 pt-3 flex gap-2">
        <ActionButton label="create" type="submit" disabled={!agent} className="flex-1" />
        <ActionButton label="cancel" variant="secondary" onClick={onCancel} className="flex-1" />
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
              className="text-xs text-zinc-500 active:text-zinc-100">
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
              <TextArea value={body} onChange={e => setBody(e.target.value)} rows={6} />
            </Field>
            <Field label="notes">
              <TextArea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="optional notes" />
            </Field>
          </div>
        ) : (
          <>
            <div className="bg-zinc-900 p-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
              {ticket.body}
            </div>
            {ticket.notes && (
              <div className="space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">notes</div>
                <div className="bg-zinc-900 p-3 text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed font-sans">
                  {ticket.notes}
                </div>
              </div>
            )}
          </>
        )}

        {chain.length > 1 && (
          <div className="space-y-1.5 pt-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">chain ({chain.length})</div>
            {chain.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 font-mono text-xs py-1 border-b border-zinc-800/50">
                <span className="text-zinc-700 shrink-0">{i === chain.length - 1 ? '→' : '·'}</span>
                <span className="text-zinc-400 truncate">{t.title}</span>
                <div className="shrink-0 ml-auto"><StatusBadge status={t.status} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="shrink-0 pt-3 flex gap-2">
          <ActionButton label="save" onClick={handleSave} className="flex-1" />
          <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
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
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const ts = await ticketApi.list({
      projectId,
      status: filter || undefined,
    })
    setTickets(ts)
    setLoading(false)
  }, [projectId, filter])

  useEffect(() => { load().catch(console.error) }, [load])

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const noSheetOpen = !selected && !showCreate

  return (
    <>
      <PageShell

        action={noSheetOpen ? { label: 'Ticket', onPress: () => setShowCreate(true) } : undefined}
        onRefresh={load}
      >
        <div className="flex gap-2 pb-4 overflow-x-auto no-scrollbar">
          {STATUS_FILTERS.map(f => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </div>

        {loading ? (
          <EmptyState message="loading…" />
        ) : tickets.length === 0 ? (
          <EmptyState message="no tickets" />
        ) : tickets.map(t => (
          <ListRow
            key={t.id}
            title={t.title}
            subtitle={[t.agent, t.parent_id ? '↳ child' : '', ts(t.created_at)].filter(Boolean).join(' · ')}
            status={t.status}
            onPress={() => setSelected(t)}
          />
        ))}
      </PageShell>

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
