import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { marked } from 'marked'
import { MessageSquare, Brain, FileText, Scale } from 'lucide-react'
import type { Execution, Activity } from '../../types.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'
import { toolIcon, toolLabel } from '../../lib/tool-display.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { ActivityRow } from '../../components/detail/ActivityRow.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { EmptyState } from '../../components/list/EmptyState.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { useShell } from '../../Shell.js'
import {
  ticketGetOpts, sessionGetOpts, agentListOpts, sessionExecutionsOpts,
  sessionActivitiesOpts, sessionUsageOpts, qk,
} from '../../queries.js'

// ── Helpers ──

function dateShort(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(raw)
    return p && typeof p === 'object' ? p as Record<string, unknown> : {}
  } catch { return {} }
}

// MCP tool names arrive from the SDK as `mcp__<server>__<name>`. Our
// display registry (toolLabel / toolIcon in lib/tool-display) keys off
// the bare name, so strip the namespace before lookup. Connection
// servers use `cloudflare:Cf` style names which the SDK transforms
// to `cloudflare_Cf` — so the server segment itself can contain `_`.
// Greedy-match everything up to the LAST `__` separator.
function bareToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const m = name.match(/^mcp__.+__(.+)$/)
  return m ? m[1] : name
}

// Activity icon + label are deterministic per kind. Tool calls get their
// richer per-tool icon and human-readable label via toolIcon/toolLabel
// ("git clone TerryTsai/foundry" rather than "called gitClone").
function iconFor(a: Activity, payload: Record<string, unknown>): React.ReactNode {
  switch (a.kind) {
    case 'prompt':    return <FileText size={14} />
    case 'thought':   return <Brain size={14} />
    case 'said':      return <MessageSquare size={14} />
    case 'reconcile': return <Scale size={14} />
    case 'tool_call': return toolIcon(bareToolName(payload.name), 14)
  }
}

// All labels are simple present-tense verbs so the feed reads uniformly.
// Tool calls already arrive as imperative verb phrases via toolLabel
// ("git clone X", "read file", "run cmd") and fit the same shape.
function labelFor(a: Activity, payload: Record<string, unknown>): string {
  switch (a.kind) {
    case 'prompt':    return 'prompt'
    case 'thought':   return 'think'
    case 'said':      return 'say'
    case 'reconcile': return 'reconcile'
    case 'tool_call': {
      const input = payload.input !== undefined ? JSON.stringify(payload.input) : null
      return toolLabel(bareToolName(payload.name), input)
    }
  }
}

// ── Row renderers ──

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose-zinc text-sm max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: marked.parse(text) as string }} />
  )
}

function ToolCallBody({ input, exec }: { input: unknown; exec?: Execution }) {
  const inputJson = JSON.stringify(input ?? {}, null, 2)
  const execStats = exec ? [
    exec.status,
    exec.exit_code !== null ? `exit ${exec.exit_code}` : null,
    exec.duration_ms !== null && exec.duration_ms > 0 ? `${(exec.duration_ms / 1000).toFixed(1)}s` : null,
  ].filter(Boolean).join(' · ') : null
  const outSnippet = exec?.stdout?.split('\n').slice(0, 4).join('\n').slice(0, 400) ?? null
  const errSnippet = exec?.stderr?.split('\n').slice(0, 4).join('\n').slice(0, 400) ?? null

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded overflow-hidden">
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

function ReconcileBody({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as { deltaIn?: number; deltaOut?: number; modelIn?: number; modelOut?: number }
  const fmt  = (n?: number) => n === undefined ? '—' : n.toLocaleString()
  const sign = (n?: number) => n === undefined ? '—' : (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString())
  const streamedIn  = d.modelIn  !== undefined && d.deltaIn  !== undefined ? d.modelIn  - d.deltaIn  : undefined
  const streamedOut = d.modelOut !== undefined && d.deltaOut !== undefined ? d.modelOut - d.deltaOut : undefined
  const md = [
    '**Token reconciliation**',
    '',
    'Session-close check that SDK-reported token usage matches what we tallied from streamed activity rows. Non-zero deltas are usually cache reads or other out-of-band charges not visible in the stream.',
    '',
    '|                          | Input            | Output            |',
    '| ------------------------ | ---------------: | ----------------: |',
    `| Billed (SDK modelUsage)  | ${fmt(d.modelIn)} | ${fmt(d.modelOut)} |`,
    `| Summed from activities   | ${fmt(streamedIn)} | ${fmt(streamedOut)} |`,
    `| **Δ reconciled**         | **${sign(d.deltaIn)}** | **${sign(d.deltaOut)}** |`,
  ].join('\n')
  return <MarkdownBody text={md} />
}

function ActivityEntry({ a, execByToolUseId, execHref }: {
  a: Activity
  execByToolUseId: Map<string, Execution>
  execHref: (id: string) => string
}) {
  const payload = parsePayload(a.payload)
  // Join on tool_use_id — stamped on both sides at write time, no race.
  const exec = a.kind === 'tool_call' && a.tool_use_id
    ? execByToolUseId.get(a.tool_use_id) : undefined

  let body: React.ReactNode = null
  let sub: { to: string; label: string } | undefined

  if (a.kind === 'prompt' || a.kind === 'thought' || a.kind === 'said') {
    const t = typeof payload.text === 'string' ? payload.text : ''
    body = t ? <MarkdownBody text={t} /> : null
  } else if (a.kind === 'tool_call') {
    body = <ToolCallBody input={payload.input} exec={exec} />
    if (exec) sub = { to: execHref(exec.id), label: 'execution' }
  } else if (a.kind === 'reconcile') {
    body = <ReconcileBody payload={payload} />
  }

  return (
    <ActivityRow
      icon={iconFor(a, payload)}
      label={labelFor(a, payload)}
      status={exec?.status ?? 'finished'}
      meta={dateShort(a.created_at)}
      sub={sub}
    >
      {body}
    </ActivityRow>
  )
}

// ── Page ──

export function TicketSessionDetailPage() {
  const { projectId } = useShell()
  const { ticketId, sessionId } = useParams()
  const queryClient = useQueryClient()
  const { data: ticket }  = useQuery(ticketGetOpts(ticketId!))
  const { data: session } = useQuery(sessionGetOpts(sessionId!))
  const { data: agents = [] }     = useQuery(agentListOpts())
  const { data: executions = [] } = useQuery(sessionExecutionsOpts(sessionId!))
  const { data: activities = [] } = useQuery(sessionActivitiesOpts(sessionId!))
  const { data: usage }           = useQuery(sessionUsageOpts(sessionId!))

  const agentName = session?.agent_name ?? agents.find(a => a.id === session?.agent_id)?.name ?? session?.agent_id ?? ''
  useBreadcrumbLabel(agentName)

  const refreshActivity = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.session.byId(sessionId!) })
  }

  if (!ticket || !session || !usage) return null

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null
  const execPath = (eId: string) => `/p/${projectId}/tickets/${ticketId}/sessions/${sessionId}/executions/${eId}`
  const ticketPath = `/p/${projectId}/tickets/${ticketId}`

  const execByToolUseId = new Map<string, Execution>()
  for (const e of executions) if (e.tool_use_id) execByToolUseId.set(e.tool_use_id, e)

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

      {/* Flat event log — one row per activity. prompt → thought → said
          → tool_call → ... → reconcile. Linear scan for audit. */}
      <div>
        <SectionLabel label={`activity (${activities.length})`} onRefresh={refreshActivity} />
        {activities.length === 0
          ? <EmptyState message="no activity" />
          : activities.map(a => (
              <ActivityEntry key={a.id} a={a} execByToolUseId={execByToolUseId} execHref={execPath} />
            ))
        }
      </div>
    </DetailShell>
  )
}
