import { useState } from 'react'
import { Link, useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { MessageSquare, Brain, FileText, Scale, Wrench } from 'lucide-react'
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

// ── Row helpers ──
// Executions and messages render into a single merged activity timeline.
// Body is always the raw message JSON prettified — stdout / stderr / cpu
// stats live on the dedicated execution detail page (reachable via the
// "view execution →" sub-link on the row header). That keeps the list
// uniform: every row is one event + its JSON payload.

function dateShort(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface Block { type: string; text?: string; thinking?: string; name?: string; id?: string }

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

// Pick an icon that actually reflects what this message is, not just "it's
// a message". Keeps the merged timeline scannable.
function messageIcon(m: Message): React.ReactNode {
  const { blocks, parsedObj } = parseContent(m.content)
  if (m.role === 'user')      return <FileText size={14} />
  if (m.role === 'reasoning') return <Brain size={14} />
  if (parsedObj && typeof parsedObj.reconcile === 'string') return <Scale size={14} />
  if (blocks) {
    const types = new Set(blocks.map(b => b.type))
    if (types.has('thinking')) return <Brain size={14} />
    if (types.has('tool_use')) return <Wrench size={14} />
  }
  return <MessageSquare size={14} />
}

function MessageRow({ m, execByToolUseId, execHref }: {
  m: Message
  execByToolUseId: Map<string, Execution>
  execHref: (id: string) => string
}) {
  const [asMarkdown, setAsMarkdown] = useState(false)
  const { blocks, plainText, parsedObj } = parseContent(m.content)

  // Label: role + content shape. Rename the two bookend rows for
  // readability — the initial founder message is the "prompt", and the
  // trailing modelUsage-delta system row is "reconciliation".
  let label: string
  if (m.role === 'user') label = 'prompt'
  else if (parsedObj && typeof parsedObj.reconcile === 'string') label = 'reconciliation'
  else if (blocks)       label = `${m.role} · ${blockTypesLabel(blocks)}`
  else                   label = m.role

  // Raw view body: prettified JSON for structured content; plain text
  // otherwise. This is the message-details view — not execution details.
  const rawBody = blocks || parsedObj
    ? JSON.stringify(blocks ?? parsedObj, null, 2)
    : (plainText ?? '')

  const mdText = blocks ? extractText(blocks) : (plainText ?? '')
  const canRenderMarkdown = mdText.length > 0

  // Tool_use blocks on this turn → correlated executions (if we have them).
  // Multi-tool turns get one link per block; the sub-link slot holds a
  // short summary when there are many, footer lists them explicitly.
  const toolUses = (blocks ?? []).filter((b): b is Block & { id: string } => b.type === 'tool_use' && typeof b.id === 'string')
  const toolExecs = toolUses
    .map(b => ({ block: b, exec: execByToolUseId.get(b.id) }))
    .filter((x): x is { block: Block & { id: string }; exec: Execution } => !!x.exec)

  const sub = toolExecs.length === 1
    ? { to: execHref(toolExecs[0].exec.id), label: 'execution' }
    : toolExecs.length > 1
      ? { to: execHref(toolExecs[0].exec.id), label: `${toolExecs.length} executions` }
      : undefined

  const execList = toolExecs.length > 1 ? (
    <div className="flex flex-col gap-1 mt-2">
      {toolExecs.map(({ block, exec }) => (
        <Link
          key={exec.id}
          to={execHref(exec.id)}
          onClick={e => e.stopPropagation()}
          className="font-mono text-[10px] text-amber-500 dark:text-amber-400 hover:underline"
        >
          {block.name ?? exec.tool_name ?? 'exec'} → execution
        </Link>
      ))}
    </div>
  ) : null

  const toggle = canRenderMarkdown ? (
    <button
      onClick={(e) => { e.stopPropagation(); setAsMarkdown(v => !v) }}
      className="inline-block font-mono text-[10px] text-amber-500 dark:text-amber-400 mb-2 hover:underline"
    >
      {asMarkdown ? 'raw json' : 'render markdown'}
    </button>
  ) : null

  const footer = (toggle || execList) ? <>{toggle}{execList}</> : null

  return (
    <ActivityRow
      key={`m-${m.id}`}
      icon={messageIcon(m)}
      label={label}
      status="done"
      meta={dateShort(m.created_at)}
      sub={sub}
      body={asMarkdown && canRenderMarkdown ? mdText : rawBody}
      mono={!(asMarkdown && canRenderMarkdown)}
      footer={footer}
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

      {/* Session page is agent-domain only: one timeline of messages
          (prompt → model turns → reconciliation). Tool executions are a
          sandbox-domain concern — they're correlated from each message's
          tool_use blocks via tool_use_id, and linked out to the execution
          detail page, not inlined here. */}
      {(() => {
        const execByToolUseId = new Map<string, Execution>()
        for (const e of executions) if (e.tool_use_id) execByToolUseId.set(e.tool_use_id, e)
        return (
          <div>
            <SectionLabel label={`messages (${messages.length})`} onRefresh={refreshActivity} />
            {messages.length === 0
              ? <EmptyState message="no messages" />
              : messages.map(m => (
                  <MessageRow
                    key={m.id}
                    m={m}
                    execByToolUseId={execByToolUseId}
                    execHref={execPath}
                  />
                ))
            }
          </div>
        )
      })()}
    </DetailShell>
  )
}
