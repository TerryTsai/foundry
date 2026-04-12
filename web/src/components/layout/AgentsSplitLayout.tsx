import { Outlet, useLoaderData, useParams, Link, useMatch, useRevalidator } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Agent } from '../../types.js'
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
  const agents = useLoaderData() as Agent[]
  const { agentId } = useParams<{ agentId: string }>()
  const { revalidate } = useRevalidator()

  // Detect bare /settings/agents index to decide mobile rendering.
  const isIndex = !!useMatch('/settings/agents')

  // ── Shared row list ────────────────────────────────────────────────────────
  function renderRows(hideChevron: boolean) {
    return (
      <div className="[&>:last-child>*]:border-b-0">
        {agents.length === 0 ? (
          <EmptyState message="no agents" />
        ) : (
          agents.map(a => (
            <Link key={a.id} to={`/settings/agents/${a.id}`} className="block">
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

  return (
    <div className="flex h-full min-w-0">
      {/* ── Desktop left panel ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60">
        <div className="shrink-0 flex items-center h-11 border-b border-zinc-200 dark:border-zinc-800/60">
          <span className="flex-1 min-w-0 px-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Agents
          </span>
          <Link
            to="/settings/agents/new"
            className="shrink-0 flex items-center gap-1 pr-4 pl-2 text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 transition-colors"
          >
            <Plus size={12} strokeWidth={2.5} />
            New
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          {renderRows(true)}
        </div>
      </aside>

      {/* ── Right panel / outlet ───────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${isIndex ? 'hidden lg:flex' : 'flex'}`}>
        <Outlet />
      </div>

      {/* ── Mobile full-screen list ────────────────────────────────────────── */}
      {isIndex && (
        <div className="lg:hidden flex flex-1 flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0 min-w-0">
            <PageShell
              action={{ label: 'Agent', onPress: '/settings/agents/new' }}
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
