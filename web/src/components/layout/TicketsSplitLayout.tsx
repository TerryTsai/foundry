import { Outlet, useParams, Link, useMatch, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Ticket } from '../../types.js'
import { useShell } from '../../Shell.js'
import {
  ticketListOpts, agentListOpts, projectTagsOpts,
} from '../../queries.js'
import { MultiSelect } from '../primitives/MultiSelect.js'
import { ListRow } from '../list/ListRow.js'
import { EmptyState } from '../list/EmptyState.js'
import { PageShell } from './PageShell.js'

// ── Filter helpers (same logic as old TicketListPage) ──────────────────────

const STATUSES = ['created', 'waiting', 'running', 'finished', 'failed', 'cancelled']
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
  const { data: tickets = [] } = useQuery(ticketListOpts({ projectId }))
  const { data: agents = [] }  = useQuery(agentListOpts())
  const { ticketId } = useParams<{ ticketId: string }>()

  // Detect whether we're at the bare index route (no child segment).
  // Used on mobile to decide: show list OR show the outlet.
  const isIndex = useMatch('/p/:projectId/tickets')

  // ── Filter state (URL search params so filters survive refresh / nav) ────

  const [searchParams, setSearchParams] = useSearchParams()

  function getParam(key: string): Set<string> {
    return new Set(searchParams.getAll(key))
  }

  function makeSetter(key: string) {
    return (next: Set<string>) => {
      setSearchParams((prev: URLSearchParams) => {
        const p = new URLSearchParams(prev)
        p.delete(key)
        next.forEach(v => p.append(key, v))
        return p
      }, { replace: true })
    }
  }

  const statuses      = getParam('status')
  const agentFilter   = getParam('agent')
  const createdFilter = getParam('created')
  const setStatuses      = makeSetter('status')
  const setAgentFilter   = makeSetter('agent')
  const setCreatedFilter = makeSetter('created')

  // Inbox toggle. Default on (absent param = inbox). Narrows to tickets that
  // need founder action: unassigned-created, or failed/cancelled.
  const inboxOn = searchParams.get('view') !== 'all'
  const anyExplicitFilter = statuses.size + agentFilter.size + createdFilter.size > 0
  const inboxActive = inboxOn && !anyExplicitFilter
  function toggleInbox() {
    setSearchParams((prev: URLSearchParams) => {
      const p = new URLSearchParams(prev)
      if (inboxOn) p.set('view', 'all')
      else         p.delete('view')
      return p
    }, { replace: true })
  }

  // Tag filter: selected tags → one query per tag → OR-merge results.
  const tagFilter    = getParam('tag')
  const setTagFilter = makeSetter('tag')
  const { data: projectTags = [] } = useQuery(projectTagsOpts(projectId))

  const selectedTags = [...tagFilter].sort()
  const tagQueries = useQueries({
    queries: selectedTags.map(tag => ticketListOpts({ projectId, tag })),
  })
  const tagLoading = selectedTags.length > 0 && tagQueries.some(q => q.isPending)
  const tagTickets: Ticket[] | null = selectedTags.length === 0
    ? null
    : (() => {
        const seen = new Set<string>()
        const merged: Ticket[] = []
        for (const q of tagQueries) {
          for (const t of (q.data ?? [])) {
            if (!seen.has(t.id)) { seen.add(t.id); merged.push(t) }
          }
        }
        return merged
      })()

  // Source: tag-filtered subset or all tickets.
  const sourceTickets = tagTickets ?? tickets

  const agentName = (t: Ticket) => agents.find(a => a.id === t.agent_id)?.name ?? 'unassigned'
  const uniqueAgentNames = Array.from(new Set(tickets.map(agentName))).sort()

  const filtered = sourceTickets.filter(t => {
    // Inbox narrows to tickets that need founder action. Skipped whenever
    // any explicit filter chip is set, so advanced filtering is unshackled.
    if (inboxActive) {
      const unassignedOpen = t.status === 'created' && !t.agent_id
      const needsDecision  = t.status === 'failed' || t.status === 'cancelled'
      if (!unassignedOpen && !needsDecision) return false
    }
    if (statuses.size > 0) {
      if (!statuses.has(t.status)) return false
    }
    if (agentFilter.size > 0 && !agentFilter.has(agentName(t))) return false
    if (createdFilter.size > 0 && !matchesDateFilter(t.created_at, createdFilter)) return false
    return true
  }).slice().sort((a, b) => b.created_at.localeCompare(a.created_at))

  // ── Shared filter chip group ───────────────────────────────────────────────

  const filterChips = (
    <>
      <button
        onClick={toggleInbox}
        className={`flex items-center px-3 py-1.5 rounded-full border text-xs transition-colors shrink-0 ${
          inboxActive
            ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
            : 'border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 active:bg-zinc-200 dark:active:bg-zinc-800'
        }`}
        title={inboxActive ? 'Showing only tickets that need action — click for all' : 'Show only tickets that need action'}
      >
        Inbox
      </button>
      <MultiSelect label="Status"  options={[...STATUSES]}                    selected={statuses}       onChange={setStatuses} />
      {uniqueAgentNames.length > 0 && (
        <MultiSelect label="Agent" options={uniqueAgentNames}                 selected={agentFilter}    onChange={setAgentFilter} />
      )}
      <MultiSelect label="Created" options={DATE_OPTIONS}                     selected={createdFilter}  onChange={setCreatedFilter} />
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
            <Link key={t.id} to={`/p/${projectId}/tickets/${t.id}`} state={{ search: searchParams.toString() }} className="block">
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
    <div className="flex min-w-0">

      {/* ── Desktop left panel (sticky, own scroll) ────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60 sticky top-12 self-start h-[calc(100dvh-3rem)]">

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

        {/* Ticket rows — scroll within the sticky aside */}
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          {renderRows(true)}
        </div>
      </aside>

      {/* ── Right panel / outlet ───────────────────────────────────────────── */}
      {/* Always visible on desktop. On mobile: visible only when NOT at index. */}
      <div className={`flex-1 min-w-0 ${isIndex ? 'hidden lg:block' : 'block'}`}>
        <Outlet context={shellCtx} />
      </div>

      {/* ── Mobile full-screen list ────────────────────────────────────────── */}
      {/* Only rendered on mobile when we're at the bare index route.
          Filter bar is sticky under the app header; list flows with doc. */}
      {isIndex && (
        <div className="lg:hidden flex-1 min-w-0">
          <div className="sticky top-12 z-10 bg-white dark:bg-zinc-950 flex items-center gap-2 px-4 h-11 border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto no-scrollbar">
            {filterChips}
          </div>
          <PageShell
            action={{ label: 'Ticket', onPress: `/p/${projectId}/tickets/new` }}
            onRefresh={async () => { revalidate() }}
          >
            {renderRows(false)}
          </PageShell>
        </div>
      )}

    </div>
  )
}
