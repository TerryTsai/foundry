import { useState, useEffect } from 'react'
import { Outlet, useLoaderData, useParams, Link, useMatch } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Ticket, Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { ticketApi, projectApi } from '../../api.js'
import { MultiSelect } from '../primitives/MultiSelect.js'
import { ListRow } from '../list/ListRow.js'
import { EmptyState } from '../list/EmptyState.js'
import { PageShell } from './PageShell.js'

// ── Filter helpers (same logic as old TicketListPage) ──────────────────────

const STATUSES = ['open', 'reopened', 'claimed', 'done', 'failed', 'blocked']
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

// ── Index placeholder (rendered in the right panel when no ticket selected) ─

export function TicketsIndexPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-zinc-400 dark:text-zinc-600 select-none">
      Select a ticket to get started
    </div>
  )
}

// ── Split layout ────────────────────────────────────────────────────────────

export function TicketsSplitLayout() {
  const shellCtx = useShell()
  const { projectId, revalidate } = shellCtx
  const { tickets, agents } = useLoaderData() as { tickets: Ticket[]; agents: Agent[] }
  const { ticketId } = useParams<{ ticketId: string }>()

  // Detect whether we're at the bare index route (no child segment).
  // Used on mobile to decide: show list OR show the outlet.
  const isIndex = useMatch('/p/:projectId/tickets')

  // ── Filter state ──────────────────────────────────────────────────────────

  const [statuses, setStatuses]       = useState<Set<string>>(new Set())
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const [createdFilter, setCreatedFilter] = useState<Set<string>>(new Set())
  const [claimedFilter, setClaimedFilter] = useState<Set<string>>(new Set())

  // Tag filter: tagFilter holds selected tags; tagTickets holds OR-merged results.
  const [tagFilter, setTagFilter]   = useState<Set<string>>(new Set())
  const [projectTags, setProjectTags] = useState<string[]>([])
  const [tagTickets, setTagTickets] = useState<Ticket[] | null>(null)
  const [tagLoading, setTagLoading] = useState(false)

  // Fetch the project's distinct tag list once on mount.
  useEffect(() => {
    projectApi.tags(projectId).then(setProjectTags).catch(() => {})
  }, [projectId])

  // OR-merge ticket lists for each selected tag.
  useEffect(() => {
    if (tagFilter.size === 0) { setTagTickets(null); return }
    setTagLoading(true)
    Promise.all([...tagFilter].map(tag => ticketApi.list({ projectId, tag })))
      .then(results => {
        const seen = new Set<string>()
        const merged: Ticket[] = []
        for (const batch of results)
          for (const t of batch)
            if (!seen.has(t.id)) { seen.add(t.id); merged.push(t) }
        setTagTickets(merged)
      })
      .finally(() => setTagLoading(false))
  }, [tagFilter, projectId])

  // Source: tag-filtered subset (from API) or all tickets from loader.
  const sourceTickets = tagTickets ?? tickets

  const agentName = (t: Ticket) => agents.find(a => a.id === t.agent_id)?.name ?? 'unassigned'
  const uniqueAgentNames = Array.from(new Set(tickets.map(agentName))).sort()

  const filtered = sourceTickets.filter(t => {
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

  // ── Shared filter chip group ───────────────────────────────────────────────

  const filterChips = (
    <>
      <MultiSelect label="Status"  options={[...STATUSES]}                    selected={statuses}       onChange={setStatuses} />
      {uniqueAgentNames.length > 0 && (
        <MultiSelect label="Agent" options={uniqueAgentNames}                 selected={agentFilter}    onChange={setAgentFilter} />
      )}
      <MultiSelect label="Created" options={DATE_OPTIONS}                     selected={createdFilter}  onChange={setCreatedFilter} />
      <MultiSelect label="Claimed" options={['unclaimed', ...DATE_OPTIONS]}   selected={claimedFilter}  onChange={setClaimedFilter} />
      {projectTags.length > 0 && (
        <MultiSelect label="Tag" options={projectTags} selected={tagFilter} onChange={setTagFilter} />
      )}
    </>
  )

  // ── Ticket row list (shared between desktop & mobile) ─────────────────────

  function renderRows(hideChevron: boolean) {
    if (tagLoading) return (
      <div className="flex items-center justify-center py-10">
        <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">filtering…</span>
      </div>
    )
    if (filtered.length === 0) return <EmptyState message="no tickets" />
    return (
      <div className="[&>:last-child>*]:border-b-0">
        {filtered.map(t => {
          const date = new Date(t.created_at).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })
          return (
            <Link key={t.id} to={`/p/${projectId}/tickets/${t.id}`} className="block">
              <ListRow
                title={t.title}
                subtitle={date}
                status={t.status}
                active={t.id === ticketId}
                hideChevron={hideChevron}
              />
            </Link>
          )
        })}
      </div>
    )
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  //
  // Desktop (lg+):
  //   [aside 320px | outlet flex-1]   both scroll independently
  //
  // Mobile:
  //   isIndex → full-screen list (with FAB for new ticket)
  //   else    → full-screen outlet (drill-in behaviour, same as before)

  return (
    <div className="flex h-full min-w-0">

      {/* ── Desktop left panel ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60">

        {/* Filter bar + New link */}
        <div className="shrink-0 flex items-center h-11 border-b border-zinc-200 dark:border-zinc-800/60">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto no-scrollbar px-4">
            {filterChips}
          </div>
          <Link
            to={`/p/${projectId}/tickets/new`}
            className="shrink-0 flex items-center gap-1 pr-4 pl-2 text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 transition-colors"
          >
            <Plus size={12} strokeWidth={2.5} />
            New
          </Link>
        </div>

        {/* Ticket rows */}
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          {renderRows(true)}
        </div>
      </aside>

      {/* ── Right panel / outlet ───────────────────────────────────────────── */}
      {/* Always visible on desktop. On mobile: visible only when NOT at index. */}
      <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${isIndex ? 'hidden lg:flex' : 'flex'}`}>
        <Outlet context={shellCtx} />
      </div>

      {/* ── Mobile full-screen list ────────────────────────────────────────── */}
      {/* Only rendered on mobile when we're at the bare index route. */}
      {isIndex && (
        <div className="lg:hidden flex flex-1 flex-col min-h-0 min-w-0">
          {/* Filter bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto no-scrollbar">
            {filterChips}
          </div>
          {/* List inside PageShell for FAB + pull-to-refresh */}
          <div className="flex-1 min-h-0 min-w-0">
            <PageShell
              action={{ label: 'Ticket', onPress: `/p/${projectId}/tickets/new` }}
              onRefresh={async () => { revalidate() }}
            >
              {renderRows(false)}
            </PageShell>
          </div>
        </div>
      )}

    </div>
  )
}
