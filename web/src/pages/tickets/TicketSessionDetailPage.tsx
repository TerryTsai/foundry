import { useState } from 'react'
import { Link, useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import type { Session, Execution, Message, UsageRollup, Ticket } from '../../types.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'
import { toolLabel, toolIcon } from '../../lib/tool-display.js'
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

// ── Message row ──
// Messages are an audit trail of what the model produced and consumed.
// Render the raw stored content (JSON blocks or plain text) by default so
// there's no ambiguity about what was actually persisted. When the content
// has renderable text (user prompt, assistant text blocks, markdown the
// agent typed), expose a toggle to view it as rendered markdown.

function dateShort(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface Block { type: string; text?: string; thinking?: string; name?: string }

function parseContent(raw: string): { blocks: Block[] | null; plainText: string | null; parsedObj: Record<string, unknown> | null } {
  const t = raw.trimStart()
  if (!t.startsWith('{') && !t.startsWith('[')) return { blocks: null, plainText: raw, parsedObj: null }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { blocks: parsed as Block[], plainText: null, parsedObj: null }
    if (parsed && typeof parsed === 'object') return { blocks: null, plainText: null, parsedObj: parsed }
  } catch { /* fall through */ }
  return { blocks: null, plainText: raw, parsedObj: null }
}

function blockTypesLabel(blocks: Block[]): string {
  // Preserve order, dedupe, count repeats. "tool_use ×5, text"
  const seen: string[] = []
  const counts = new Map<string, number>()
  for (const b of blocks) {
    if (!counts.has(b.type)) seen.push(b.type)
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1)
  }
  return seen.map(t => { const n = counts.get(t)!; return n > 1 ? `${t} ×${n}` : t }).join(', ')
}

function extractText(blocks: Block[]): string {
  return blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n\n')
}

function MessageRow({ m }: { m: Message }) {
  const [asMarkdown, setAsMarkdown] = useState(false)
  const { blocks, plainText, parsedObj } = parseContent(m.content)

  // Label: role + content shape
  let label = m.role
  if (blocks)           label = `${m.role} · ${blockTypesLabel(blocks)}`
  else if (parsedObj && typeof parsedObj.reconcile === 'string') label = `${m.role} · ${parsedObj.reconcile}`

  // Raw view body: prettified JSON for structured content; plain text otherwise.
  const rawBody = blocks || parsedObj
    ? JSON.stringify(blocks ?? parsedObj, null, 2)
    : (plainText ?? '')

  // Markdown-renderable text available?
  const mdText = blocks ? extractText(blocks) : (plainText ?? '')
  const canRenderMarkdown = mdText.length > 0

  const toggle = canRenderMarkdown ? (
    <button
      onClick={(e) => { e.stopPropagation(); setAsMarkdown(v => !v) }}
      className="inline-block font-mono text-[10px] text-amber-500 dark:text-amber-400 mb-2 hover:underline"
    >
      {asMarkdown ? '← raw json' : 'render markdown →'}
    </button>
  ) : null

  if (asMarkdown && canRenderMarkdown) {
    return (
      <ActivityRow
        key={`m-${m.id}`}
        icon={<MessageSquare size={14} />}
        label={label}
        meta={dateShort(m.created_at)}
        body={mdText}
        footer={toggle}
      />
    )
  }
  return (
    <ActivityRow
      key={`m-${m.id}`}
      icon={<MessageSquare size={14} />}
      label={label}
      meta={dateShort(m.created_at)}
      body={rawBody}
      mono
      footer={toggle}
    />
  )
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

      {/* Executions and messages are genuinely different units (resources
          vs. model I/O); splitting them into two sections keeps each
          surface honest about what it's measuring. Ticket comments stay
          on the ticket page — this page is the audit view. */}
      <div>
        <SectionLabel label={`activity (${executions.length})`} onRefresh={refreshActivity} />
        {executions.length === 0
          ? <EmptyState message="no executions" />
          : executions.map(e => (
              <ActivityRow
                key={`e-${e.id}`}
                icon={toolIcon(e.tool_name)}
                label={toolLabel(e.tool_name, e.tool_input)}
                status={e.status}
                meta={ts(e.started_at)}
                body=""
                footer={<ExecutionBody e={e} />}
                detailHref={execPath(e.id)}
                detailLabel="view execution"
              />
            ))
        }
      </div>

      <div>
        <SectionLabel label={`messages (${messages.length})`} />
        {messages.length === 0
          ? <EmptyState message="no messages" />
          : messages.map(m => <MessageRow key={m.id} m={m} />)
        }
      </div>
    </DetailShell>
  )
}
