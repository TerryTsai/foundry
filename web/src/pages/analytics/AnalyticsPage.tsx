import { useState } from 'react'
import { useLoaderData, useParams } from 'react-router-dom'
import { PageShell } from '../../components/layout/PageShell.js'
import { projectApi } from '../../api.js'
import type { Analytics, AnalyticsDay, AnalyticsAgent, AnalyticsTag } from '../../types.js'
import { fmtTokens, fmtDuration, fmtBytes } from '../../lib/format.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(n: number, d: number): string {
  if (d === 0) return '—'
  return `${Math.round((n / d) * 100)}%`
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100)
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ── Date range filter ─────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'all', days: 365 },
]

interface RangeFilterProps {
  days: number
  onChange: (days: number) => void
}

function RangeFilter({ days, onChange }: RangeFilterProps) {
  return (
    <div className="flex gap-1 self-start">
      {RANGE_OPTIONS.map(o => (
        <button
          key={o.days}
          onClick={() => onChange(o.days)}
          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
            days === o.days
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

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
      <StatCard label="tokens in" value={fmtTokens(data.total_tokens_in)} />
      <StatCard label="tokens out" value={fmtTokens(data.total_tokens_out)} />
      <StatCard label="duration" value={data.total_duration_ms > 0 ? fmtDuration(data.total_duration_ms) : '—'} />
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

// ── Agent performance table ───────────────────────────────────────────────────

function AgentTable({ agents }: { agents: AnalyticsAgent[] }) {
  if (agents.length === 0) return (
    <p className="text-xs text-zinc-600 py-2">no agent data in range</p>
  )
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[540px]">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800/60">
            <th className="text-left font-normal pb-2 pr-4">agent</th>
            <th className="text-right font-normal pb-2 pr-4">sessions</th>
            <th className="text-left font-normal pb-2 pr-4 min-w-[120px]">success</th>
            <th className="text-right font-normal pb-2">avg dur</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => {
            const rate = pct(a.sessions_done, a.sessions)
            return (
              <tr key={a.agent_id} className="border-b border-zinc-800/40 hover:bg-zinc-900/30 transition-colors">
                <td className="py-2 pr-4 text-zinc-200 font-medium truncate max-w-[150px]">{a.agent_name}</td>
                <td className="py-2 pr-4 text-right font-mono text-zinc-400">{a.sessions}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden min-w-[60px]">
                      <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                    <span className="font-mono text-zinc-400 w-8 text-right shrink-0">{fmtPct(a.sessions_done, a.sessions)}</span>
                  </div>
                </td>
                <td className="py-2 text-right font-mono text-zinc-400">{a.avg_duration_ms > 0 ? fmtDuration(a.avg_duration_ms) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Feature cost table (by tag) ───────────────────────────────────────────────

function TagTable({ tags }: { tags: AnalyticsTag[] }) {
  if (tags.length === 0) return null
  const sorted = [...tags].sort((a, b) => b.sessions - a.sessions)
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[440px]">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800/60">
            <th className="text-left font-normal pb-2 pr-4">tag</th>
            <th className="text-right font-normal pb-2 pr-4">tickets</th>
            <th className="text-right font-normal pb-2 pr-4">sessions</th>
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
              <td className="py-2 text-right font-mono text-zinc-400">{t.duration_ms > 0 ? fmtDuration(t.duration_ms) : '—'}</td>
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

export function AnalyticsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const initial = useLoaderData() as Analytics
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Analytics>(initial)
  const [loading, setLoading] = useState(false)

  async function handleRangeChange(d: number) {
    setDays(d)
    setLoading(true)
    try {
      const fresh = await projectApi.analytics(projectId!, d)
      setData(fresh)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    const fresh = await projectApi.analytics(projectId!, days)
    setData(fresh)
  }

  return (
    <PageShell onRefresh={handleRefresh}>
      <div className={`space-y-8 max-w-3xl mx-auto pb-8 transition-opacity ${loading ? 'opacity-50' : 'opacity-100'}`}>

        <RangeFilter days={days} onChange={handleRangeChange} />

        <Section title="summary">
          <SummarySection data={data.summary} />
        </Section>

        <Section title="daily activity">
          <DailyChart daily={data.daily} />
        </Section>

        <Section title="agent performance">
          <AgentTable agents={data.agents} />
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
  )
}
