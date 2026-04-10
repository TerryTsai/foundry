import { useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { Terminal, MessageSquare, Brain, FileText } from 'lucide-react'
import type { Session, Execution, Message, UsageRollup } from '../../types.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'
import { bustCache } from '../../api.js'

interface SessionLoaderData {
  session: Session
  executions: Execution[]
  messages: Message[]
  usage: UsageRollup
}

// ── Tool call formatter ──

function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + '…' : s
}

function formatToolCall(name: string | null, inputJson: string | null): string {
  if (!name) return 'exec'
  let input: any = {}
  if (inputJson) { try { input = JSON.parse(inputJson) } catch { /* fall through */ } }
  switch (name) {
    case 'read':   return `read ${input.path ?? ''}${input.offset ? ` from ${input.offset}` : ''}`
    case 'write':  return `write ${input.path ?? ''}`
    case 'patch':  return `patch ${input.path ?? ''}`
    case 'search': return `search "${truncate(input.pattern ?? '', 40)}"${input.path ? ` in ${input.path}` : ''}`
    case 'find':   return `find ${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}`
    case 'exec':   return `exec ${truncate(input.command ?? '', 60)}`
    case 'fetch':  return `fetch ${input.url ?? ''}`
    case 'scrape': return `scrape ${input.url ?? ''}`
    case 'ticket': return `ticket ${input.action ?? ''}${input.id ? ` ${input.id}` : input.title ? ` "${truncate(input.title, 40)}"` : ''}`
    case 'agents': return 'list agents'
    default:       return name
  }
}

// ── Context window meter ──

const fmtTokens = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)

// Map a model identifier to its input context window. Defaults to 200k
// (the common Anthropic limit) for unknown models.
function contextLimit(model: string): number {
  if (model.startsWith('anthropic:')) return 200_000
  if (model.startsWith('openai:gpt-4o'))      return 128_000
  if (model.startsWith('openai:gpt-4-turbo')) return 128_000
  if (model.startsWith('openai:gpt-4'))       return 8_192
  if (model.startsWith('openai:gpt-3.5'))     return 16_385
  return 200_000
}

function ContextMeter({ peakIn, limit }: { peakIn: number; limit: number }) {
  const pct = limit > 0 ? Math.min((peakIn / limit) * 100, 100) : 0
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-zinc-600 dark:text-zinc-500 shrink-0 w-20 text-sm">context</span>
      <div className="flex-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 font-mono">
        {fmtTokens(peakIn)} / {fmtTokens(limit)} ({pct < 1 ? '<1' : pct.toFixed(0)}%)
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
  const { session, executions, messages, usage } = useLoaderData() as SessionLoaderData
  const { projectId } = useShell()
  const { ticketId, sessionId } = useParams()
  const { revalidate } = useRevalidator()
  const agentName = session.agent_name ?? session.agent_id
  useBreadcrumbLabel(agentName)

  const refreshActivity = async () => { bustCache(); revalidate() }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null
  const timeline = buildTimeline(messages, executions)
  const peakTokensIn = messages.reduce((max, m) => m.tokens_in !== null && m.tokens_in > max ? m.tokens_in : max, 0)
  const ctxLimit = contextLimit(session.model)
  const execPath = (eId: string) => `/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${eId}`

  return (
    <DetailShell
      type="session" id={session.id} title={agentName} status={session.status}
      infoRows={[
        { label: 'model',       value: session.model },
        { label: 'duration',    value: duration },
        { label: 'reason',      value: session.finish_reason },
        { label: 'steps',       value: session.step_count !== null ? String(session.step_count) : null },
        { label: 'tokens in',   value: session.tokens_in  !== null ? session.tokens_in.toLocaleString()  : null },
        { label: 'tokens out',  value: session.tokens_out !== null ? session.tokens_out.toLocaleString() : null },
        { label: 'tool calls',  value: session.tool_calls !== null ? String(session.tool_calls)          : null },
        { label: 'cpu',         value: usage.cpu_ms > 0 ? fmtDuration(usage.cpu_ms) : null },
        { label: 'memory',      value: usage.peak_memory_mb !== null ? `${usage.peak_memory_mb.toFixed(0)} MB peak` : null },
        { label: 'network',     value: usage.net_bytes > 0 ? fmtBytes(usage.net_bytes) : null },
        { label: 'started',     value: ts(session.started_at) },
        { label: 'ended',       value: session.ended_at ? ts(session.ended_at) : null },
      ]}
    >
      {peakTokensIn > 0 && <ContextMeter peakIn={peakTokensIn} limit={ctxLimit} />}

      {session.error && (
        <div>
          <SectionLabel label="error" />
          <pre className="font-mono text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed px-4">{session.error}</pre>
        </div>
      )}

      <div>
        <SectionLabel label={`activity (${timeline.length})`} onRefresh={refreshActivity} />
        {timeline.length === 0
          ? <EmptyState message="no activity" />
          : timeline.map(entry => {
              if (entry.kind === 'execution') {
                const e = entry.data
                return (
                  <ActivityRow
                    key={`e-${e.id}`}
                    icon={<Terminal size={14} />}
                    label={formatToolCall(e.tool_name, e.tool_input)}
                    status={e.status}
                    meta={ts(e.started_at)}
                    body=""
                    footer={<ExecutionBody e={e} />}
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
                />
              )
            })
        }
      </div>
    </DetailShell>
  )
}
