import { useState } from 'react'
import { Link, useLoaderData, useParams, useRevalidator } from 'react-router-dom'
import { marked } from 'marked'
import { MessageSquare, Brain, FileText, Scale, Wrench, ChevronRight } from 'lucide-react'
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

// ── Block renderers ──
// Each block type in an assistant BetaMessage gets its own visual
// treatment. Tool_use blocks fold in a short summary of their
// correlated execution so the common case ("did it work? what did it
// print?") doesn't require drilling out.

function TextBlockView({ text }: { text: string }) {
  const [asMarkdown, setAsMarkdown] = useState(true)
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">text</span>
        <button
          onClick={() => setAsMarkdown(v => !v)}
          className="font-mono text-[10px] text-amber-500 dark:text-amber-400 hover:underline"
        >{asMarkdown ? 'raw' : 'markdown'}</button>
      </div>
      {asMarkdown
        ? <div className="prose-zinc text-sm max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: marked.parse(text) as string }} />
        : <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre leading-relaxed select-text overflow-x-auto">{text}</pre>
      }
    </div>
  )
}

function ThinkingBlockView({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        thinking · {text.length.toLocaleString()} chars
      </button>
      {open && (
        <pre className="mt-2 pl-4 border-l-2 border-zinc-200 dark:border-zinc-800 font-mono text-xs text-zinc-400 dark:text-zinc-500 whitespace-pre-wrap leading-relaxed select-text">{text}</pre>
      )}
    </div>
  )
}

function ToolUseBlockView({ block, exec, execHref }: {
  block: Block & { id: string; name?: string; input?: unknown }
  exec?: Execution
  execHref: (id: string) => string
}) {
  const name = block.name ?? exec?.tool_name ?? 'exec'
  const inputJson = JSON.stringify(block.input ?? {}, null, 2)
  const execStats = exec ? [
    exec.status,
    exec.exit_code !== null ? `exit ${exec.exit_code}` : null,
    exec.duration_ms !== null && exec.duration_ms > 0 ? `${(exec.duration_ms / 1000).toFixed(1)}s` : null,
  ].filter(Boolean).join(' · ') : null
  const outSnippet = exec?.stdout?.split('\n').slice(0, 4).join('\n').slice(0, 400) ?? null
  const errSnippet = exec?.stderr?.split('\n').slice(0, 4).join('\n').slice(0, 400) ?? null

  return (
    <div className="mb-3 border border-zinc-200 dark:border-zinc-800 rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">tool_use</span>
          <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100 truncate">{name}</span>
        </div>
        {exec && (
          <Link
            to={execHref(exec.id)}
            onClick={e => e.stopPropagation()}
            className="shrink-0 font-mono text-[10px] text-amber-500 dark:text-amber-400 hover:underline"
          >execution</Link>
        )}
      </div>
      <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre leading-relaxed select-text overflow-x-auto px-3 py-2">{inputJson}</pre>
      {exec && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2 bg-zinc-50/50 dark:bg-zinc-900/30">
          {execStats && <div className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500 mb-1">{execStats}</div>}
          {outSnippet && (
            <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-all leading-relaxed select-text overflow-auto max-h-24">{outSnippet}</pre>
          )}
          {errSnippet && (
            <pre className="font-mono text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed select-text overflow-auto max-h-16 mt-1">{errSnippet}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function UnknownBlockView({ block }: { block: Block }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 mb-1">{block.type}</div>
      <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre leading-relaxed select-text overflow-x-auto">{JSON.stringify(block, null, 2)}</pre>
    </div>
  )
}

function ReconcileView({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as { deltaIn?: number; deltaOut?: number; modelIn?: number; modelOut?: number }
  const sign = (n?: number) => n === undefined ? '' : (n >= 0 ? `+${n}` : String(n))
  return (
    <div className="mb-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
      <div>Δ {sign(d.deltaIn)} in · Δ {sign(d.deltaOut)} out</div>
      {d.modelIn !== undefined && d.modelOut !== undefined && (
        <div className="text-zinc-400 dark:text-zinc-500">Reconciled against SDK modelUsage: {d.modelIn.toLocaleString()} in / {d.modelOut.toLocaleString()} out billed. Per-turn sum adjusted so session total matches exactly.</div>
      )}
    </div>
  )
}

function MessageRow({ m, execByToolUseId, execHref }: {
  m: Message
  execByToolUseId: Map<string, Execution>
  execHref: (id: string) => string
}) {
  const { blocks, plainText, parsedObj } = parseContent(m.content)

  // Label: role + content shape. Rename the two bookend rows.
  let label: string
  if (m.role === 'user') label = 'prompt'
  else if (parsedObj && typeof parsedObj.reconcile === 'string') label = 'reconciliation'
  else if (blocks)       label = `${m.role} · ${blockTypesLabel(blocks)}`
  else                   label = m.role

  // Sub-link in the row header — one link if a single tool_use on the
  // turn, count if multiple, none otherwise. Per-block links appear
  // inside each tool_use card body anyway.
  const toolUses = (blocks ?? []).filter((b): b is Block & { id: string } => b.type === 'tool_use' && typeof b.id === 'string')
  const toolExecs = toolUses
    .map(b => ({ block: b, exec: execByToolUseId.get(b.id) }))
    .filter((x): x is { block: Block & { id: string }; exec: Execution } => !!x.exec)
  const sub = toolExecs.length === 1
    ? { to: execHref(toolExecs[0].exec.id), label: 'execution' }
    : toolExecs.length > 1
      ? { to: execHref(toolExecs[0].exec.id), label: `${toolExecs.length} executions` }
      : undefined

  // Render the expanded body block-by-block. Plain-text user prompts
  // and system reconciliation rows get direct treatment.
  let content: React.ReactNode
  if (parsedObj && typeof parsedObj.reconcile === 'string') {
    content = <ReconcileView payload={parsedObj} />
  } else if (blocks) {
    content = blocks.map((b, i) => {
      if (b.type === 'text'     && typeof b.text === 'string')     return <TextBlockView     key={i} text={b.text} />
      if (b.type === 'thinking' && typeof b.thinking === 'string') return <ThinkingBlockView key={i} text={b.thinking} />
      if (b.type === 'tool_use' && typeof (b as { id?: string }).id === 'string') {
        const tu = b as Block & { id: string; name?: string; input?: unknown }
        return <ToolUseBlockView key={i} block={tu} exec={execByToolUseId.get(tu.id)} execHref={execHref} />
      }
      return <UnknownBlockView key={i} block={b} />
    })
  } else if (plainText) {
    content = <TextBlockView text={plainText} />
  } else {
    content = <pre className="font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre overflow-x-auto">{m.content}</pre>
  }

  return (
    <ActivityRow
      key={`m-${m.id}`}
      icon={messageIcon(m)}
      label={label}
      status="done"
      meta={dateShort(m.created_at)}
      sub={sub}
    >
      {content}
    </ActivityRow>
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
