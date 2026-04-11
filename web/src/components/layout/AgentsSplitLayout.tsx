import { Outlet, useLoaderData, useParams, Link, useMatch } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { ListRow } from '../list/ListRow.js'
import { EmptyState } from '../list/EmptyState.js'
import { PageShell } from './PageShell.js'

// ── Index placeholder (rendered in the right panel when no agent selected) ──
export function AgentsIndexPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-zinc-400 dark:text-zinc-600 select-none">
      Select an agent
    </div>
  )
}

// ── Split layout ────────────────────────────────────────────────────────────
export function AgentsSplitLayout() {
  const shellCtx = useShell()
  const { projectId, revalidate } = shellCtx
  const agents = useLoaderData() as Agent[]
  const { agentId } = useParams<{ agentId: string }>()

  // Detect whether we're at the bare index route (no child segment).
  // Used on mobile to decide: show list OR show the outlet.
  const isIndex = useMatch('/p/:projectId/agents')

  // Detect if we're on any connections sub-route (for Connections row active highlight).
  const isConnections = !!useMatch({ path: '/p/:projectId/agents/connections', end: false })

  // ── Shared row list (desktop left panel & mobile full-screen list) ────────
  function renderRows(hideChevron: boolean) {
    return (
      <div className="[&>:last-child>*]:border-b-0">
        {/* Connections row always at the top */}
        <Link to={`/p/${projectId}/agents/connections`} className="block">
          <ListRow
            title="Connections"
            subtitle="credentials for LLMs and integrations"
            active={isConnections}
            hideChevron={hideChevron}
          />
        </Link>
        {/* Agent rows */}
        {agents.length === 0 ? (
          <EmptyState message="no agents" />
        ) : (
          agents.map(a => (
            <Link key={a.id} to={`/p/${projectId}/agents/${a.id}`} className="block">
              <ListRow
                title={a.name}
                subtitle={a.model}
                active={a.id === agentId}
                hideChevron={hideChevron}
              />
            </Link>
          ))
        )}
      </div>
    )
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  //
  // Desktop (lg+):
  //   [aside 320px | outlet flex-1]   both scroll independently
  //
  // Mobile:
  //   isIndex → full-screen list (with FAB for new agent)
  //   else    → full-screen outlet (drill-in behaviour, same as before)
  return (
    <div className="flex h-full min-w-0">
      {/* ── Desktop left panel ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60">
        {/* Panel header with New link */}
        <div className="shrink-0 flex items-center h-11 border-b border-zinc-200 dark:border-zinc-800/60">
          <span className="flex-1 min-w-0 px-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Agents
          </span>
          <Link
            to={`/p/${projectId}/agents/new`}
            className="shrink-0 flex items-center gap-1 pr-4 pl-2 text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 transition-colors"
          >
            <Plus size={12} strokeWidth={2.5} />
            New
          </Link>
        </div>
        {/* List rows */}
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
          <div className="flex-1 min-h-0 min-w-0">
            <PageShell
              action={{ label: 'Agent', onPress: `/p/${projectId}/agents/new` }}
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
