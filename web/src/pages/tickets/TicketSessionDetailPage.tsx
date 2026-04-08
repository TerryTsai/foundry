import { useLoaderData, useParams } from 'react-router-dom'
import { Terminal, MessageSquare, Brain, FileText } from 'lucide-react'
import type { Session, Execution, Message } from '../../types.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'

interface SessionLoaderData {
  session: Session
  executions: Execution[]
  messages: Message[]
}

// ── Context bar ──

const fmtTokens = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)

function ContextBar({ tokensIn, total }: { tokensIn: number; total: number }) {
  const pct = total > 0 ? Math.min((tokensIn / total) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 font-mono">
        {fmtTokens(tokensIn)} / {fmtTokens(total)}
      </span>
    </div>
  )
}

// ── Execution body (shown when expanded) ──

function ExecutionBody({ e }: { e: Execution }) {
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

  let firstUser = true
  for (const m of messages) {
    if (m.role === 'user') {
      if (firstUser) { firstUser = false }
      else { continue }
    }
    if (isJsonContent(m.content)) continue
    entries.push({ kind: 'message', data: m, at: m.created_at })
  }

  for (const e of executions) {
    entries.push({ kind: 'execution', data: e, at: e.started_at })
  }

  entries.sort((a, b) => a.at.localeCompare(b.at))

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].kind !== 'message') continue
    let j = i - 1
    while (j >= 0 && entries[j].kind === 'execution') j--
    const prevMsgAt = j >= 0 && entries[j].kind === 'message' ? entries[j].at : ''
    let insertAt = i
    for (let k = j + 1; k < i; k++) {
      if (entries[k].kind === 'execution' && entries[k].at > prevMsgAt) {
        insertAt = k
        break
      }
    }
    if (insertAt < i) {
      const msg = entries.splice(i, 1)[0]
      entries.splice(insertAt, 0, msg)
    }
  }

  return entries
}

// ── Page ──

export function TicketSessionDetailPage() {
  const { session, executions, messages } = useLoaderData() as SessionLoaderData
  const { projectId } = useShell()
  const { ticketId, sessionId } = useParams()
  const agentName = session.agent_name ?? session.agent_id
  useBreadcrumbLabel(agentName)

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null
  const timeline = buildTimeline(messages, executions)
  const peakTokensIn = messages.reduce((max, m) => m.tokens_in !== null && m.tokens_in > max ? m.tokens_in : max, 0)
  const execPath = (eId: string) => `/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${eId}`

  return (
    <DetailShell
      type="session" id={session.id} title={agentName} status={session.status}
      infoRows={[
        { label: 'model',       value: session.model },
        { label: 'duration',    value: duration },
        { label: 'cost',        value: session.cost_usd !== null ? `$${session.cost_usd.toFixed(4)}` : null },
        { label: 'reason',      value: session.finish_reason },
        { label: 'steps',       value: session.step_count !== null ? String(session.step_count) : null },
        { label: 'tool calls',  value: session.tool_calls !== null ? String(session.tool_calls) : null },
        { label: 'tokens in',   value: session.tokens_in !== null ? session.tokens_in.toLocaleString() : null },
        { label: 'tokens out',  value: session.tokens_out !== null ? session.tokens_out.toLocaleString() : null },
        { label: 'started',     value: ts(session.started_at) },
        { label: 'ended',       value: session.ended_at ? ts(session.ended_at) : null },
      ]}
    >
      {session.error && (
        <div>
          <SectionLabel label="error" />
          <pre className="font-mono text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed px-4">{session.error}</pre>
        </div>
      )}

      <div>
        <SectionLabel label={`activity (${timeline.length})`} />
        {timeline.length === 0
          ? <EmptyState message="no activity" />
          : (() => {
            let lastTokensIn: number | null = null
            return timeline.map(entry => {
              if (entry.kind === 'message') {
                lastTokensIn = entry.data.tokens_in
              }
              const tokensIn = entry.kind === 'message' ? entry.data.tokens_in : lastTokensIn
              const bar = tokensIn !== null && peakTokensIn > 0 ? <ContextBar tokensIn={tokensIn} total={peakTokensIn} /> : undefined

              if (entry.kind === 'execution') {
                const e = entry.data
                return (
                  <ActivityRow
                    key={`e-${e.id}`}
                    icon={<Terminal size={14} />}
                    label={e.tool_name ?? 'exec'}
                    status={e.status}
                    meta={ts(e.started_at)}
                    body=""
                    footer={<>{<ExecutionBody e={e} />}{bar}</>}
                    detailHref={execPath(e.id)}
                    detailLabel="view execution"
                  />
                )
              }

              const m = entry.data
              const icon = m.role === 'reasoning' ? <Brain size={14} /> : m.role === 'user' ? <FileText size={14} /> : <MessageSquare size={14} />
              const label = m.role === 'reasoning' ? 'thinking' : m.role === 'user' ? 'prompt' : 'message'
              return (
                <ActivityRow
                  key={`m-${m.id}`}
                  icon={icon}
                  label={label}
                  status="done"
                  meta={ts(m.created_at)}
                  body={m.content}
                  footer={bar}
                />
              )
            })
          })()
        }
      </div>
    </DetailShell>
  )
}
