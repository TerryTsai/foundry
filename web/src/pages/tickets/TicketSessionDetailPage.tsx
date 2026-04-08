import { useState } from 'react'
import { useLoaderData, useParams, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { Session, Execution, Message } from '../../types.js'
import { InfoGroup } from '../../components/detail/InfoGroup.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'

interface SessionLoaderData {
  session: Session
  executions: Execution[]
  messages: Message[]
}

// ── Context bar ──

const CTX_LIMIT = 200_000
const fmtTokens = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)

function ContextBar({ tokensIn }: { tokensIn: number }) {
  const pct = Math.min((tokensIn / CTX_LIMIT) * 100, 100)
  const color = pct >= 75 ? 'bg-red-500' : 'bg-amber-500'
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 font-mono">
        {fmtTokens(tokensIn)} / {fmtTokens(CTX_LIMIT)}
      </span>
    </div>
  )
}

// ── Execution body (shown when expanded) ──

function ExecutionBody({ e, href }: { e: Execution; href: string }) {
  const stats = [
    e.exit_code !== null ? `exit ${e.exit_code}` : null,
    e.duration_ms !== null ? `${(e.duration_ms / 1000).toFixed(1)}s` : null,
    e.peak_memory_mb !== null ? `${e.peak_memory_mb.toFixed(1)} MB` : null,
    e.cpu_ms !== null ? `${(e.cpu_ms / 1000).toFixed(2)}s cpu` : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <pre className="font-mono text-xs text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-all leading-relaxed select-text mb-1">{e.command}</pre>
      {stats && <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 mb-2">{stats}</div>}
      {e.stdout && (
        <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-all leading-relaxed select-text max-h-48 overflow-auto">{e.stdout}</pre>
      )}
      {e.stderr && (
        <pre className="font-mono text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed select-text max-h-32 overflow-auto mt-1">{e.stderr}</pre>
      )}
      <Link to={href} className="inline-block font-mono text-[10px] text-amber-500 dark:text-amber-400 mt-2 hover:underline">
        details →
      </Link>
    </>
  )
}

// ── Timeline ──

function isJsonContent(content: string): boolean {
  const t = content.trimStart()
  return t.startsWith('[{') || t.startsWith('[  {')
}

type TimelineEntry =
  | { kind: 'execution'; data: Execution; at: string }
  | { kind: 'message'; data: Message; at: string }

function buildTimeline(messages: Message[], executions: Execution[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const m of messages) {
    if (m.role === 'user') continue
    if (isJsonContent(m.content)) continue
    entries.push({ kind: 'message', data: m, at: m.created_at })
  }

  for (const e of executions) {
    entries.push({ kind: 'execution', data: e, at: e.started_at })
  }

  entries.sort((a, b) => a.at.localeCompare(b.at))
  return entries
}

const roleStatus: Record<string, string> = {
  assistant: 'assistant',
  reasoning: 'thinking',
}

// ── Page ──

export function TicketSessionDetailPage() {
  const { session, executions, messages } = useLoaderData() as SessionLoaderData
  const { projectId } = useShell()
  const { ticketId, sessionId } = useParams()
  const [promptOpen, setPromptOpen] = useState(false)

  const agentName = session.agent_name ?? session.agent_id
  useBreadcrumbLabel(agentName)

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null
  const timeline = buildTimeline(messages, executions)
  const execPath = (eId: string) => `/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${eId}`

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agentName}</h2>

      <InfoGroup rows={[
        { label: 'status',      value: session.status },
        { label: 'reason',      value: session.finish_reason },
        { label: 'model',       value: session.model },
        { label: 'steps',       value: session.step_count !== null ? String(session.step_count) : null },
        { label: 'tool calls',  value: session.tool_calls !== null ? String(session.tool_calls) : null },
        { label: 'tokens in',   value: session.tokens_in !== null ? session.tokens_in.toLocaleString() : null },
        { label: 'tokens out',  value: session.tokens_out !== null ? session.tokens_out.toLocaleString() : null },
        { label: 'cost',        value: session.cost_usd !== null ? `$${session.cost_usd.toFixed(4)}` : null },
        { label: 'started',     value: ts(session.started_at) },
        { label: 'ended',       value: session.ended_at ? ts(session.ended_at) : null },
        { label: 'duration',    value: duration },
      ]} />

      {session.system_prompt && (
        <div>
          <button
            onClick={() => setPromptOpen(o => !o)}
            className="flex items-center gap-1 w-full"
          >
            <ChevronRight
              size={12} strokeWidth={2}
              className={`text-zinc-400 dark:text-zinc-500 transition-transform ${promptOpen ? 'rotate-90' : ''}`}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              system prompt
            </span>
            <span className="text-[10px] text-zinc-300 dark:text-zinc-600 ml-1">
              {(session.system_prompt.length / 1000).toFixed(1)}k chars
            </span>
          </button>
          {promptOpen && (
            <pre className="font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words leading-relaxed select-text bg-zinc-50 dark:bg-zinc-900/50 rounded p-3 mt-2 max-h-96 overflow-auto">
              {session.system_prompt}
            </pre>
          )}
        </div>
      )}

      {session.error && (
        <div className="space-y-1">
          <SectionLabel label="error" />
          <pre className="font-mono text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed px-4">{session.error}</pre>
        </div>
      )}

      <div>
        <SectionLabel label={`activity (${timeline.length})`} />
        {timeline.length === 0
          ? <EmptyState message="no activity" />
          : timeline.map(entry => {
            if (entry.kind === 'execution') {
              const e = entry.data
              return (
                <ActivityRow
                  key={`e-${e.id}`}
                  label="Tool Call: run_command"
                  status={e.status}
                  meta={ts(e.started_at)}
                  body=""
                  mono
                  footer={<ExecutionBody e={e} href={execPath(e.id)} />}
                />
              )
            }

            const m = entry.data
            const firstLine = m.content.split('\n')[0].slice(0, 80)
            return (
              <ActivityRow
                key={`m-${m.id}`}
                label={firstLine}
                status={roleStatus[m.role] ?? m.role}
                meta={ts(m.created_at)}
                body={m.content}
                footer={m.tokens_in !== null ? <ContextBar tokensIn={m.tokens_in} /> : undefined}
              />
            )
          })
        }
      </div>
    </div>
  )
}
