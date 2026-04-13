import { useState } from 'react'
import { Link, useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { MessageSquare, Brain, FileText, Scale, Wrench } from 'lucide-react'
import type { Session, Execution, Message, UsageRollup, Ticket } from '../../types.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'
import { toolIcon, toolLabel } from '../../lib/tool-display.js'
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

function MessageRow({ m }: { m: Message }) {
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

  const toggle = canRenderMarkdown ? (
    <button
      onClick={(e) => { e.stopPropagation(); setAsMarkdown(v => !v) }}
      className="inline-block font-mono text-[10px] text-amber-500 dark:text-amber-400 mb-2 hover:underline"
    >
      {asMarkdown ? '← raw json' : 'render markdown →'}
    </button>
  ) : null

  return (
    <ActivityRow
      key={`m-${m.id}`}
      icon={messageIcon(m)}
      label={label}
      status="done"
      meta={dateShort(m.created_at)}
      body={asMarkdown && canRenderMarkdown ? mdText : rawBody}
      mono={!(asMarkdown && canRenderMarkdown)}
      footer={toggle}
    />
  )
}

// Execution row renders the same-shape JSON body as a message row:
// { type: "tool_use", name, input } — exactly the payload the model sent
// to the tool. stdout/stderr/cpu/mem/network still live on the execution
// detail page, reachable via the "view execution →" sub-link.
function ExecutionRow({ e, sub }: { e: Execution; sub: string }) {
  const name = e.tool_name ?? 'exec'
  const input = (() => {
    if (!e.tool_input) return {}
    try { return JSON.parse(e.tool_input) } catch { return e.tool_input }
  })()
  const body = JSON.stringify({ type: 'tool_use', name, input }, null, 2)

  return (
    <ActivityRow
      key={`e-${e.id}`}
      icon={toolIcon(e.tool_name)}
      label={toolLabel(e.tool_name, e.tool_input)}
      status={e.status}
      meta={dateShort(e.started_at)}
      sub={{ to: sub, label: 'view execution' }}
      body={body}
      mono
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

      {/* One merged timeline: prompt → model turns / tool calls / executions
          → reconciliation. Sort everything by timestamp so the founder
          reads the session top-to-bottom in the order it happened. */}
      {(() => {
        type Item =
          | { kind: 'exec'; at: string; e: Execution }
          | { kind: 'msg';  at: string; m: Message }
        const items: Item[] = [
          ...executions.map(e => ({ kind: 'exec' as const, at: e.started_at,  e })),
          ...messages.map(m   => ({ kind: 'msg'  as const, at: m.created_at, m })),
        ].sort((a, b) => a.at.localeCompare(b.at))

        return (
          <div>
            <SectionLabel label={`activity (${items.length})`} onRefresh={refreshActivity} />
            {items.length === 0
              ? <EmptyState message="no activity" />
              : items.map(it => it.kind === 'exec'
                  ? <ExecutionRow key={`e-${it.e.id}`} e={it.e} sub={execPath(it.e.id)} />
                  : <MessageRow   key={`m-${it.m.id}`} m={it.m} />)
            }
          </div>
        )
      })()}
    </DetailShell>
  )
}
