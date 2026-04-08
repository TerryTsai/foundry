import { useState } from 'react'
import { Link, useLoaderData } from 'react-router-dom'
import type { Ticket, Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { PageShell } from '../../components/layout/PageShell.js'
import { MultiSelect } from '../../components/primitives/MultiSelect.js'
import { ListRow } from '../../components/list/ListRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'

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

export function TicketListPage() {
  const { projectId, revalidate } = useShell()
  const { tickets, agents } = useLoaderData() as { tickets: Ticket[]; agents: Agent[] }
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const [createdFilter, setCreatedFilter] = useState<Set<string>>(new Set())
  const [claimedFilter, setClaimedFilter] = useState<Set<string>>(new Set())

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

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto no-scrollbar">
        <MultiSelect label="Status" options={[...STATUSES]} selected={statuses} onChange={setStatuses} />
        {uniqueAgentNames.length > 0 && (
          <MultiSelect label="Agent" options={uniqueAgentNames} selected={agentFilter} onChange={setAgentFilter} />
        )}
        <MultiSelect label="Created" options={DATE_OPTIONS} selected={createdFilter} onChange={setCreatedFilter} />
        <MultiSelect label="Claimed" options={['unclaimed', ...DATE_OPTIONS]} selected={claimedFilter} onChange={setClaimedFilter} />
      </div>

      <div className="flex-1 min-h-0">
        <PageShell
          action={{ label: 'Ticket', onPress: `/p/${projectId}/tickets/new` }}
          onRefresh={async () => { revalidate() }}
        >
          {filtered.length === 0 ? (
            <EmptyState message="no tickets" />
          ) : <div className="[&>:last-child>*]:border-b-0">{filtered.map(t => {
            const date = new Date(t.created_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
            return (
              <Link key={t.id} to={`/p/${projectId}/tickets/${t.id}`} className="block">
                <ListRow title={t.title} subtitle={date} status={t.status} />
              </Link>
            )
          })}</div>}
        </PageShell>
      </div>
    </div>
  )
}
