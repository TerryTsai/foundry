import { useState, useEffect, useCallback } from 'react'
import { ticketApi, projectApi, agentApi } from '../api.js'
import type { Ticket, Project, AgentDef } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'

const STATUSES = ['open', 'claimed', 'done', 'failed', 'blocked']

const inputCls = 'w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 font-mono text-sm px-3 py-2 focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors'
const labelCls = 'font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600'
const btnPrimary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-2.5 active:opacity-75 transition-opacity'
const btnSecondary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 py-2.5 active:opacity-75 transition-opacity'

function TicketForm({ projects, onSave, onCancel }: { projects: Project[]; onSave: () => void; onCancel: () => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agent, setAgent] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectId) return
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
    <form onSubmit={handleSubmit} className="space-y-3">
      <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">New Ticket</h2>
      {error && <div className="font-mono text-xs text-red-500">{error}</div>}
      <div className="space-y-1">
        <label className={labelCls}>project</label>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} required className={inputCls}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className={labelCls}>agent</label>
        <select value={agent} onChange={e => setAgent(e.target.value)} required className={inputCls}>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          {agents.length === 0 && <option value="">no agents in project</option>}
        </select>
      </div>
      <div className="space-y-1">
        <label className={labelCls}>title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} required className={inputCls} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>description</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} required rows={5}
          className={`${inputCls} resize-none`} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={!agent} className={`${btnPrimary} disabled:opacity-40`}>create</button>
        <button type="button" onClick={onCancel} className={btnSecondary}>cancel</button>
      </div>
    </form>
  )
}

function TicketDetail({ ticket, onClose, onUpdate }: { ticket: Ticket; onClose: () => void; onUpdate: () => void }) {
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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100 leading-snug">{ticket.title}</h2>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <StatusBadge status={ticket.status} />
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100">
              edit
            </button>
          )}
        </div>
      </div>

      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-600 space-y-0.5 border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div>agent <span className="text-zinc-600 dark:text-zinc-400">{ticket.agent}</span></div>
        <div>created <span className="text-zinc-600 dark:text-zinc-400">{ts(ticket.created_at)}</span></div>
        {ticket.claimed_at && <div>claimed <span className="text-zinc-600 dark:text-zinc-400">{ts(ticket.claimed_at)}</span></div>}
        {ticket.parent_id && <div>parent <span className="text-zinc-600 dark:text-zinc-400">{ticket.parent_id}</span></div>}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className={labelCls}>body</div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className={`${inputCls} resize-none`} />
          </div>
          <div className="space-y-1">
            <div className={labelCls}>notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className={`${inputCls} resize-none`} placeholder="optional notes" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className={btnPrimary}>save</button>
            <button onClick={() => setEditing(false)} className={btnSecondary}>cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
            {ticket.body}
          </div>
          {ticket.notes && (
            <div className="space-y-1">
              <div className={labelCls}>notes</div>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed font-sans">
                {ticket.notes}
              </div>
            </div>
          )}
        </>
      )}

      {chain.length > 1 && (
        <div className="space-y-1.5 pt-1">
          <div className={labelCls}>chain ({chain.length})</div>
          {chain.map((t, i) => (
            <div key={t.id} className="flex items-center gap-2 font-mono text-xs py-1 border-b border-zinc-100 dark:border-zinc-800/50">
              <span className="text-zinc-300 dark:text-zinc-700 shrink-0">{i === chain.length - 1 ? '→' : '·'}</span>
              <span className="text-zinc-600 dark:text-zinc-400 truncate">{t.title}</span>
              <div className="shrink-0 ml-auto"><StatusBadge status={t.status} /></div>
            </div>
          ))}
        </div>
      )}

      {ticket.status === 'failed' && (
        <button onClick={handleReopen}
          className="w-full font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 py-2.5 active:opacity-75 mt-1">
          reopen
        </button>
      )}
    </div>
  )
}

export function TicketsView() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filters, setFilters] = useState({ projectId: '', agent: '', status: '' })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [ts, ps] = await Promise.all([
      ticketApi.list({
        projectId: filters.projectId || undefined,
        agent: filters.agent || undefined,
        status: filters.status || undefined,
      }),
      projectApi.list(),
    ])
    setTickets(ts)
    setProjects(ps)
    setLoading(false)
  }, [filters])

  useEffect(() => { load().catch(console.error) }, [load])

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setFilters(f => ({ ...f, [key]: e.target.value }))

  const ts = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const filterSelectCls = 'bg-transparent border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] uppercase tracking-wider px-2 py-1.5 shrink-0'

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 shrink-0">
            {tickets.length}
          </span>
          <button onClick={() => setShowCreate(true)}
            className="font-mono text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800 px-3 py-1.5 shrink-0">
            + new
          </button>
          <select value={filters.projectId} onChange={setFilter('projectId')} className={filterSelectCls}>
            <option value="">all projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={filters.status} onChange={setFilter('status')} className={filterSelectCls}>
            <option value="">all statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={filters.agent} onChange={setFilter('agent')} placeholder="agent"
            className={`${filterSelectCls} w-20`} />
          <button onClick={load}
            className="font-mono text-xs text-zinc-300 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 shrink-0 ml-auto px-1">
            ↻
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">loading…</div>
        ) : tickets.length === 0 ? (
          <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no tickets</div>
        ) : tickets.map(t => (
          <button key={t.id} onClick={() => setSelected(t)}
            className="w-full text-left border-b border-zinc-100 dark:border-zinc-800/50 active:bg-zinc-50 dark:active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-zinc-800 dark:text-zinc-200 text-sm leading-snug truncate">{t.title}</div>
              <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 flex items-center gap-2">
                <span>{t.agent}</span>
                {t.parent_id && <span>↳ child</span>}
                <span>{ts(t.created_at)}</span>
              </div>
            </div>
            <div className="shrink-0"><StatusBadge status={t.status} /></div>
          </button>
        ))}
      </div>

      <Sheet open={showCreate} onClose={() => setShowCreate(false)}>
        <TicketForm
          projects={projects}
          onSave={() => { setShowCreate(false); load().catch(console.error) }}
          onCancel={() => setShowCreate(false)}
        />
      </Sheet>

      <Sheet open={selected !== null} onClose={() => setSelected(null)}>
        {selected && (
          <TicketDetail
            ticket={selected}
            onClose={() => setSelected(null)}
            onUpdate={() => { load().catch(console.error); setSelected(null) }}
          />
        )}
      </Sheet>
    </div>
  )
}
