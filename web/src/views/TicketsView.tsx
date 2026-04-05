import { useState, useEffect, useCallback } from 'react'
import { ticketApi, projectApi } from '../api.js'
import type { Ticket, Project } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'

const STATUSES = ['open', 'claimed', 'done', 'failed', 'blocked']

function TicketDetail({ ticket, onClose, onUpdate }: { ticket: Ticket; onClose: () => void; onUpdate: () => void }) {
  const [chain, setChain] = useState<Ticket[]>([])

  useEffect(() => {
    ticketApi.chain(ticket.id).then(setChain).catch(console.error)
  }, [ticket.id])

  async function handleReopen() {
    await ticketApi.reopen(ticket.id)
    onUpdate()
    onClose()
  }

  const ts = (s: string) => new Date(s).toLocaleString()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-lg text-zinc-100 leading-tight">{ticket.title}</h2>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="font-mono text-xs text-zinc-500 space-y-0.5">
        <div>id: {ticket.id}</div>
        <div>agent: {ticket.agent}</div>
        <div>created: {ts(ticket.created_at)}</div>
        {ticket.claimed_at && <div>claimed: {ts(ticket.claimed_at)}</div>}
        {ticket.parent_id && <div>parent: {ticket.parent_id}</div>}
      </div>

      <div className="bg-zinc-950 rounded p-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
        {ticket.body}
      </div>

      {ticket.notes && (
        <div>
          <div className="font-mono text-xs text-zinc-500 mb-1">notes</div>
          <div className="bg-zinc-950 rounded p-3 text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {ticket.notes}
          </div>
        </div>
      )}

      {chain.length > 1 && (
        <div>
          <div className="font-mono text-xs text-zinc-500 mb-2">chain ({chain.length})</div>
          <div className="space-y-1">
            {chain.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 font-mono text-xs">
                <span className="text-zinc-600">{i === chain.length - 1 ? '→' : '·'}</span>
                <span className="text-zinc-400 truncate">{t.title}</span>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {ticket.status === 'failed' && (
        <button
          onClick={handleReopen}
          className="w-full font-mono text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded transition-colors"
        >
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

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap gap-2 shrink-0">
        <select value={filters.projectId} onChange={setFilter('projectId')} className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded px-2 py-1">
          <option value="">all projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.status} onChange={setFilter('status')} className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded px-2 py-1">
          <option value="">all statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={filters.agent}
          onChange={setFilter('agent')}
          placeholder="agent filter"
          className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded px-2 py-1 w-32"
        />
        <button onClick={load} className="font-mono text-xs text-zinc-500 hover:text-zinc-300 ml-auto">refresh</button>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        {loading ? (
          <div className="p-4 font-mono text-xs text-zinc-500">loading…</div>
        ) : tickets.length === 0 ? (
          <div className="p-4 font-mono text-xs text-zinc-500">no tickets</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="font-mono text-xs text-zinc-500 font-normal text-left px-4 py-2">title</th>
                <th className="font-mono text-xs text-zinc-500 font-normal text-left px-2 py-2 hidden sm:table-cell">agent</th>
                <th className="font-mono text-xs text-zinc-500 font-normal text-left px-2 py-2">status</th>
                <th className="font-mono text-xs text-zinc-500 font-normal text-right px-4 py-2 hidden md:table-cell">created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
                >
                  <td className="px-4 py-2.5 text-zinc-200 leading-tight">
                    <div className="truncate max-w-[180px] sm:max-w-xs">{t.title}</div>
                    {t.parent_id && <div className="font-mono text-xs text-zinc-600 mt-0.5">↳ child</div>}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-zinc-400 hidden sm:table-cell">{t.agent}</td>
                  <td className="px-2 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 text-right hidden md:table-cell">{ts(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
