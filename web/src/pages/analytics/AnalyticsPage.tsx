import { useState } from 'react'
import { useLoaderData } from 'react-router-dom'
import { PageShell } from '../../components/layout/PageShell.js'
import { AppHeader } from '../../components/layout/AppHeader.js'
import { analyticsApi } from '../../api.js'
import type { Analytics, AnalyticsDay, AnalyticsAgent, AnalyticsTag, AnalyticsTool, Project, Agent } from '../../types.js'
import { fmtTokens, fmtDuration, fmtBytes, fmtCost } from '../../lib/format.js'
import { MultiSelect } from '../../components/primitives/MultiSelect.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100)
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ── Filter options ────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'all', days: 365 },
]
const RANGE_LABELS = RANGE_OPTIONS.map(o => o.label)
const RANGE_BY_LABEL: Record<string, number> = Object.fromEntries(RANGE_OPTIONS.map(o => [o.label, o.days]))

// ── Summary stats ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 py-3 px-4 bg-zinc-900/50 rounded-lg border border-zinc-800/60">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
      <span className="text-lg font-mono text-zinc-100">{value}</span>
    </div>
  )
}

function SummarySection({ data }: { data: Analytics['summary'] }) {
  const successRate = pct(data.sessions_done, data.total_sessions)
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <StatCard label="sessions" value={String(data.total_sessions)} />
      <StatCard label="success rate" value={data.total_sessions === 0 ? '—' : `${successRate}%`} />
      <StatCard label="cost" value={fmtCost(data.total_cost_usd)} />
      <StatCard label="duration" value={data.total_duration_ms > 0 ? fmtDuration(data.total_duration_ms) : '—'} />
      <StatCard label="tokens in" value={fmtTokens(data.total_tokens_in)} />
      <StatCard label="tokens out" value={fmtTokens(data.total_tokens_out)} />
      <StatCard label="tickets done" value={String(data.tickets_done)} />
      <StatCard label="net i/o" value={data.total_net_bytes > 0 ? fmtBytes(data.total_net_bytes) : '—'} />
    </div>
  )
}

// ── Daily activity chart (SVG) ────────────────────────────────────────────────

function DailyChart({ daily }: { daily: AnalyticsDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  // Only show last N days where we have data. Filter out leading zero days for display.
  const maxSessions = Math.max(...daily.map(d => d.sessions), 1)

  // Show every Nth date label to avoid crowding
  const labelEvery = daily.length > 30 ? 14 : daily.length > 14 ? 7 : 1

  const BAR_H = 80  // px height for session bars

  return (
    <div className="space-y-1">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">sessions / day</span>

      {/* Session bars */}
      <div className="relative flex items-end gap-px" style={{ height: BAR_H }}>
        {daily.map((d, i) => {
          const doneH = Math.round((d.sessions_done / maxSessions) * BAR_H)
          const failH = Math.round((d.sessions_failed / maxSessions) * BAR_H)
          const isHov = hovered === i
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col justify-end cursor-default relative group"
              style={{ height: BAR_H }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {isHov && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 whitespace-nowrap pointer-events-none">
                  {shortDate(d.date)}: {d.sessions} sessions
                </div>
              )}
              {failH > 0 && (
                <div className="w-full bg-rose-500/60" style={{ height: failH }} />
              )}
              {doneH > 0 && (
                <div className="w-full bg-emerald-500/50" style={{ height: doneH }} />
              )}
              {d.sessions === 0 && (
                <div className="w-full bg-zinc-800/40" style={{ height: 2 }} />
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis date labels */}
      <div className="flex gap-px">
        {daily.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {i % labelEvery === 0 && (
              <span className="text-[9px] text-zinc-600">{shortDate(d.date)}</span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/50" /> done
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500/60" /> failed
        </span>
      </div>
    </div>
  )
}

// ── Agent + tool surface (proportional area) ──────────────────────────────────
// One block per agent (versioned — superseded versions render dimmed). Each
// block stacks: header (name, cost, sessions, breadth), cost-share bar
// (this agent's % of total), and a tool-use surface (proportional rectangles
// colored by tool category). Replaces the prior agent + tool tables.

const CAT_COLOR: Record<string, string> = {
  foundry:     'bg-sky-500/80',
  github:      'bg-emerald-500/80',
  sandbox:     'bg-amber-500/80',
  browser:     'bg-violet-500/80',
  integration: 'bg-rose-500/80',
  other:       'bg-zinc-500/80',
}

function toolCategory(name: string): keyof typeof CAT_COLOR {
  if (name.startsWith('ticket') || ['agentsList', 'sessionList', 'connectionList', 'think'].includes(name)) return 'foundry'
  if (name.startsWith('git') || name.startsWith('workspace')) return 'github'
  if (['read', 'write', 'patch', 'remove', 'search', 'find', 'exec', 'run', 'bash'].includes(name)) return 'sandbox'
  if (['fetch', 'scrape'].includes(name)) return 'browser'
  return 'integration'
}

// Assign v1/v2/… version labels for agents whose name appears more than
// once. Singletons get null (no suffix). Numbering follows created_at asc.
function buildVersionLabels(agents: AnalyticsAgent[]): Map<string, string | null> {
  const byName = new Map<string, AnalyticsAgent[]>()
  for (const a of agents) {
    const arr = byName.get(a.agent_name) ?? []
    arr.push(a); byName.set(a.agent_name, arr)
  }
  const out = new Map<string, string | null>()
  for (const [, list] of byName) {
    if (list.length === 1) { out.set(list[0].agent_id, null); continue }
    const sorted = [...list].sort((a, b) => a.agent_created_at.localeCompare(b.agent_created_at))
    sorted.forEach((a, i) => out.set(a.agent_id, `v${i + 1}`))
  }
  return out
}

// Subtle category-tinted backgrounds for the chip details view.
const CAT_TINT: Record<string, string> = {
  foundry:     'bg-sky-500/15 text-sky-200',
  github:      'bg-emerald-500/15 text-emerald-200',
  sandbox:     'bg-amber-500/15 text-amber-200',
  browser:     'bg-violet-500/15 text-violet-200',
  integration: 'bg-rose-500/15 text-rose-200',
  other:       'bg-zinc-500/15 text-zinc-300',
}

// Routers shouldn't touch non-foundry tools; QA shouldn't create tickets.
// Devs are unconstrained. Returns null when no rule applies.
function isRouter(name: string): boolean {
  return name === 'Adviser' || name === 'Product Vision' || name === 'Product Manager'
}
function isOutOfRole(agentName: string, toolName: string): boolean {
  if (isRouter(agentName)) return toolCategory(toolName) !== 'foundry'
  if (agentName === 'QA Engineer') return toolName === 'ticketCreate'
  return false
}

interface Anomaly {
  agent: string
  tool: string
  count: number
  reason: 'out-of-role' | 'high-fail'
  detail?: string
}
function findAnomalies(tools: AnalyticsTool[]): Anomaly[] {
  const out: Anomaly[] = []
  for (const t of tools) {
    if (isOutOfRole(t.agent_name, t.name)) {
      out.push({ agent: t.agent_name, tool: t.name, count: t.calls, reason: 'out-of-role', detail: 'out of role' })
    }
    // Fail rate: only flag when the sample is meaningful (≥3 calls) and
    // failure share is ≥20%.
    if (t.calls >= 3 && t.fail / t.calls >= 0.2) {
      out.push({
        agent: t.agent_name, tool: t.name, count: t.calls, reason: 'high-fail',
        detail: `${Math.round((t.fail / t.calls) * 100)}% fail (${t.fail}/${t.calls})`,
      })
    }
  }
  return out
}

function AnomalyCallout({ tools }: { tools: AnalyticsTool[] }) {
  const alerts = findAnomalies(tools)
  if (alerts.length === 0) return null
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-amber-300/90 font-medium">
        <span>⚠</span><span>{alerts.length} alert{alerts.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="space-y-1">
        {alerts.map((a, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs text-zinc-300">
            <span className="text-zinc-500 shrink-0">{a.agent}</span>
            <span className="text-zinc-600">→</span>
            <span className="font-mono text-amber-200/90">{a.tool}</span>
            <span className="text-zinc-500 ml-auto shrink-0 text-[11px]">{a.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Compact category mix strip. Always 5 segments max; labels always fit.
function CategoryStrip({ tools }: { tools: AnalyticsTool[] }) {
  const totals: Record<string, number> = { foundry: 0, github: 0, sandbox: 0, browser: 0, integration: 0 }
  for (const t of tools) totals[toolCategory(t.name)] += t.calls
  const sum = Object.values(totals).reduce((s, n) => s + n, 0)
  if (sum === 0) return null
  const segments = (Object.entries(totals) as Array<[keyof typeof CAT_COLOR, number]>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => ({ cat: k, n, pct: Math.round((n / sum) * 100) }))
    .sort((a, b) => b.n - a.n)
  return (
    <div>
      <div className="flex h-2 rounded overflow-hidden bg-zinc-900/40 gap-px">
        {segments.map(s => (
          <div key={s.cat} className={CAT_COLOR[s.cat]} style={{ width: `${(s.n / sum) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] font-mono">
        {segments.map(s => (
          <span key={s.cat} className="flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-sm ${CAT_COLOR[s.cat]}`} />
            <span className="text-zinc-400">{s.cat}</span>
            <span className="text-zinc-500 tabular-nums">{s.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// Expandable tool detail — sorted chip list, on demand.
function ToolDetail({ tools }: { tools: AnalyticsTool[] }) {
  const sorted = [...tools].sort((a, b) => b.calls - a.calls)
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {sorted.map(t => {
        const tint = CAT_TINT[toolCategory(t.name)]
        return (
          <span key={t.name} className={`${tint} text-[10px] font-mono px-1.5 py-0.5 rounded`}>
            {t.name}
            <span className="text-zinc-400 ml-1 tabular-nums">{t.calls}</span>
            {t.fail > 0 && <span className="text-rose-300 ml-1 tabular-nums">·{t.fail}f</span>}
          </span>
        )
      })}
    </div>
  )
}

function AgentBlocks({ agents, tools }: { agents: AnalyticsAgent[]; tools: AnalyticsTool[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (agents.length === 0) return (
    <p className="text-xs text-zinc-600 py-2">no agent activity in range</p>
  )
  const labels = buildVersionLabels(agents)
  const totalCost = agents.reduce((n, a) => n + a.cost_usd, 0)
  const sorted = [...agents].sort((a, b) => b.cost_usd - a.cost_usd)

  // Group tools by agent_id (preserve per-agent calls-desc order from backend).
  const toolsByAgent = new Map<string, AnalyticsTool[]>()
  for (const t of tools) {
    const arr = toolsByAgent.get(t.agent_id) ?? []
    arr.push(t); toolsByAgent.set(t.agent_id, arr)
  }
  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  return (
    <div className="space-y-4">
      <AnomalyCallout tools={tools} />
      {sorted.map(a => {
        const label    = labels.get(a.agent_id)
        const old      = !!a.agent_superseded_at
        const myTools  = toolsByAgent.get(a.agent_id) ?? []
        const breadth  = myTools.length
        const failSum  = myTools.reduce((n, t) => n + t.fail, 0)
        const costPct  = totalCost > 0 ? (a.cost_usd / totalCost) * 100 : 0
        const open     = expanded.has(a.agent_id)

        return (
          <div key={a.agent_id} className={old ? 'opacity-50' : ''}>
            {/* identity + headline */}
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm font-medium text-zinc-100 truncate">{a.agent_name}</span>
                {label && <span className="text-[10px] text-zinc-500 font-mono">{label}</span>}
                {old && <span className="text-[9px] uppercase tracking-wider text-zinc-600">superseded</span>}
              </div>
              <div className="flex items-baseline gap-3 text-xs font-mono shrink-0 tabular-nums">
                <span className="text-zinc-200">{fmtCost(a.cost_usd)}</span>
                <span className="text-zinc-500">{a.sessions} sess</span>
                <span className="text-amber-400/80" title="distinct tools used">{breadth} tool{breadth === 1 ? '' : 's'}</span>
                {failSum > 0 && <span className="text-rose-400" title="failed tool calls">{failSum} fail</span>}
              </div>
            </div>

            {/* cost share within project */}
            <div className="h-1 bg-zinc-900 rounded mb-2 overflow-hidden">
              <div className="h-full rounded bg-sky-500/70" style={{ width: `${costPct}%` }} />
            </div>

            {/* category mix — answers "what kind of work" without the per-tool noise */}
            <CategoryStrip tools={myTools} />

            {/* tool-level detail — on demand */}
            {breadth > 0 && (
              <button
                type="button"
                onClick={() => toggle(a.agent_id)}
                className="mt-2 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {open ? 'hide' : 'show'} {breadth} tool{breadth === 1 ? '' : 's'} {open ? '▴' : '▾'}
              </button>
            )}
            {open && <ToolDetail tools={myTools} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Feature cost table (by tag) ───────────────────────────────────────────────

function TagTable({ tags }: { tags: AnalyticsTag[] }) {
  if (tags.length === 0) return null
  const sorted = [...tags].sort((a, b) => b.cost_usd - a.cost_usd)
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[520px]">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800/60">
            <th className="text-left  font-normal pb-2 pr-4">tag</th>
            <th className="text-right font-normal pb-2 pr-4">tickets</th>
            <th className="text-right font-normal pb-2 pr-4">sessions</th>
            <th className="text-right font-normal pb-2 pr-4">cost</th>
            <th className="text-right font-normal pb-2">duration</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(t => (
            <tr key={t.tag} className="border-b border-zinc-800/40 hover:bg-zinc-900/30 transition-colors">
              <td className="py-2 pr-4">
                <span className="font-mono text-sky-400/80">{t.tag}</span>
              </td>
              <td className="py-2 pr-4 text-right font-mono text-zinc-400">{t.tickets}</td>
              <td className="py-2 pr-4 text-right font-mono text-zinc-400">{t.sessions}</td>
              <td className="py-2 pr-4 text-right font-mono text-zinc-200">{fmtCost(t.cost_usd)}</td>
              <td className="py-2          text-right font-mono text-zinc-400">{t.duration_ms > 0 ? fmtDuration(t.duration_ms) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Ticket throughput ─────────────────────────────────────────────────────────

function TicketThroughput({ summary }: { summary: Analytics['summary'] }) {
  const total = summary.total_tickets
  const open = summary.tickets_open
  const done = summary.tickets_done
  const failed = summary.tickets_failed

  const rows: Array<{ label: string; count: number; cls: string }> = [
    { label: 'open',   count: open,   cls: 'bg-sky-500/50' },
    { label: 'done',   count: done,   cls: 'bg-emerald-500/50' },
    { label: 'failed', count: failed, cls: 'bg-rose-500/60' },
  ]

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 w-12 shrink-0">{r.label}</span>
          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
            {total > 0 && (
              <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${pct(r.count, total)}%` }} />
            )}
          </div>
          <span className="text-xs font-mono text-zinc-400 w-8 text-right shrink-0">{r.count}</span>
        </div>
      ))}
      <p className="text-xs text-zinc-600">{total} total tickets</p>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface AnalyticsLoaderData {
  analytics: Analytics
  projects: Project[]
  agents: Agent[]
}

export function AnalyticsPage() {
  const { analytics: initial, projects, agents } = useLoaderData() as AnalyticsLoaderData

  // Filter state. MultiSelects for parity with the tickets filter bar,
  // but narrowing only honors a single choice per dimension — the backend
  // accepts one projectId / agentId at a time. If the founder picks more
  // than one the first stays effective and the rest are decorative.
  const [range,   setRange]   = useState<Set<string>>(new Set(['30d']))
  const [project, setProject] = useState<Set<string>>(new Set())
  const [agent,   setAgent]   = useState<Set<string>>(new Set())
  const [data,    setData]    = useState<Analytics>(initial)
  const [loading, setLoading] = useState(false)

  const days = RANGE_BY_LABEL[[...range][0] ?? '30d'] ?? 30
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id
  const agentName   = (id: string) => agents.find(a => a.id === id)?.name   ?? id
  const projectOptions = projects.map(p => p.name)
  const agentOptions   = agents.map(a => a.name)

  async function refetch(opts: { days: number; projectId?: string; agentId?: string }) {
    setLoading(true)
    try { setData(await analyticsApi.get(opts)) }
    finally { setLoading(false) }
  }

  function currentFilters(): { days: number; projectId?: string; agentId?: string } {
    const pickedProjectName = [...project][0]
    const pickedAgentName   = [...agent][0]
    const projectId = pickedProjectName ? projects.find(p => p.name === pickedProjectName)?.id : undefined
    const agentId   = pickedAgentName   ? agents.find(a => a.name === pickedAgentName)?.id     : undefined
    return { days, projectId, agentId }
  }

  function handleRangeChange(next: Set<string>)   { setRange(next);   refetch({ ...currentFilters(), days: RANGE_BY_LABEL[[...next][0] ?? '30d'] ?? 30 }) }
  function handleProjectChange(next: Set<string>) { setProject(next); const pid = [...next][0]; refetch({ ...currentFilters(), projectId: pid ? projects.find(p => p.name === pid)?.id : undefined }) }
  function handleAgentChange(next: Set<string>)   { setAgent(next);   const aid = [...next][0]; refetch({ ...currentFilters(), agentId:   aid ? agents.find(a => a.name === aid)?.id     : undefined }) }

  async function handleRefresh() { await refetch(currentFilters()) }

  // Suppress lint: projectName/agentName currently unused — kept for future
  // inline display (e.g. "Foundry only" banner when filtered).
  void projectName; void agentName

  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-zinc-950">
      <AppHeader><span className="text-sm text-zinc-500 dark:text-zinc-400">Analytics</span></AppHeader>

      {/* Filter bar — identical markup + classes to the tickets filter pane so
          it visually anchors the page the same way. */}
      <div className="shrink-0 flex items-center h-11 border-b border-zinc-200 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto no-scrollbar px-4">
          <MultiSelect label="Range"   options={RANGE_LABELS}    selected={range}   onChange={handleRangeChange} />
          {projectOptions.length > 1 && (
            <MultiSelect label="Project" options={projectOptions} selected={project} onChange={handleProjectChange} />
          )}
          {agentOptions.length > 0 && (
            <MultiSelect label="Agent"   options={agentOptions}   selected={agent}   onChange={handleAgentChange} />
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <PageShell onRefresh={handleRefresh}>
          <div className={`space-y-8 max-w-3xl mx-auto pb-8 transition-opacity ${loading ? 'opacity-50' : 'opacity-100'}`}>

        <Section title="summary">
          <SummarySection data={data.summary} />
        </Section>

        <Section title="daily activity">
          <DailyChart daily={data.daily} />
        </Section>

        <Section title="agents">
          <AgentBlocks agents={data.agents} tools={data.tools} />
        </Section>

        {data.tags.length > 0 && (
          <Section title="activity by tag">
            <TagTable tags={data.tags} />
          </Section>
        )}

        <Section title="ticket throughput">
          <TicketThroughput summary={data.summary} />
        </Section>

          </div>
        </PageShell>
      </div>
    </div>
  )
}
