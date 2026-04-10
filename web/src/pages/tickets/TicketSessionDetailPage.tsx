import { Link, useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { Terminal, MessageSquare, Brain, FileText } from 'lucide-react'
import type { Session, Execution, Message, UsageRollup, Ticket } from '../../types.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'
import { bustCache } from '../../api.js'

interface SessionLoaderData {
  ticket: Ticket
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
  const { ticket, session, executions, messages, usage } = useLoaderData() as SessionLoaderData
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
  const execPath = (eId: string) => `/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${eId}`
  const ticketPath = `/p/${projectId}/tickets/${ticketId}`

  return (
    <DetailShell
      type="session" id={session.id} title={agentName} status={session.status}
      backLink={
        <Link
          to={ticketPath}
          className="hidden lg:block text-sm text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 truncate"
        >
          ← {ticket.title}
        </Link>
      }
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
