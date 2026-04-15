// Foundry harness introspection server. Every tool call runs in the
// sandbox via runCommand, curling back into the service's HTTP API with
// the per-boot internal bearer token. This gives each call the same
// execution-row treatment as sandbox/github/browser tools: full cgroup
// stats (memory, CPU, network), resource offloading to the container,
// and consistent observability in the activity timeline.
//
// The internal token is never exposed to the agent — it lives in the
// tier-2 container's env and dies with the container. The agent sees
// the tool by name and arguments; the curl is an implementation detail.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import { asText, esc, runCommand, toolUseId } from './shared.js'

import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'foundry',
  name:        'Foundry',
  category:    'core',
  description: 'Foundry harness introspection: tickets, agents, sessions, connections.',
  tools: [
    { name: 'ticketList',    description: 'List tickets in the current project.' },
    { name: 'ticketGet',     description: 'Fetch a ticket by id.' },
    { name: 'ticketCreate',  description: 'Create a new ticket in the current project.' },
    { name: 'ticketComment', description: 'Post a comment on a ticket.' },
    { name: 'ticketReopen',  description: 'Reopen a resolved ticket so the scheduler dispatches it again.' },
    { name: 'verdictReport', description: 'Verifier-only: report pass/fail for the producer\'s work on this ticket.' },
    { name: 'ticketTagAdd',    description: 'Add a tag to a ticket.' },
    { name: 'ticketTagRemove', description: 'Remove a tag from a ticket.' },
    { name: 'agentsList',    description: 'List agents configured in the account.' },
    { name: 'sessionList',   description: 'List agent sessions for a ticket.' },
    { name: 'connectionList',  description: 'List configured external connections (LLM backends, integrations).' },
    { name: 'think',         description: 'Scratch reasoning pad. No side effects.' },
  ],
}

export interface FoundryCtx {
  db:         Db
  config:     Config
  sessionId:  string
  workspace:  string   // session tmpdir — mounted into the sandbox
  projectId:  string
  accountId:  string   // owner of the project — used for agent/connection lookups
  ticketId:   string   // parent ticket — used as parent_id when agent creates sub-tickets
  agentName:  string   // used as author of comments and created_by for new tickets
  toolUseId?: string   // per-call: BetaMessage tool_use block id. Set by the sdkTool wrapper from extra._meta["claudecode/toolUseId"]; passed to runCommand so every resulting execution row carries its correlation back to the agent-domain message.
}

// ── Schemas ──

const ticketListArgs = z.object({
  status:   z.enum(['opened', 'claimed', 'resolved']).optional().describe('Filter by ticket state.'),
  outcome:  z.enum(['finished', 'failed', 'cancelled']).optional().describe('Filter resolved tickets by outcome.'),
  agent_id: z.string().optional().describe('Filter by assigned agent id.'),
  tag:      z.string().optional().describe('Filter by tag.'),
})

const ticketGetArgs = z.object({
  id: z.string().describe('Ticket id.'),
})

const ticketCreateArgs = z.object({
  title:       z.string().describe('Short title.'),
  description: z.string().describe('Full description, markdown allowed.'),
  agent_id:    z.string().optional().describe('Optional: assign to a specific agent by id. Use agentsList first to discover ids.'),
  priority:    z.number().int().optional().describe('Optional priority (default 0).'),
  depends_on:  z.string().optional().describe('Optional: id of a ticket this one depends on. Scheduler will not dispatch this ticket until the dependency is resolved with outcome=finished.'),
})

const verdictReportArgs = z.object({
  pass:   z.boolean().describe('true = the work meets the acceptance criteria; false = it does not.'),
  reason: z.string().describe('Brief explanation. On fail, name the specific criterion that failed and what the producer should fix.'),
})

const ticketCommentArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket to comment on. Defaults to the current session\'s ticket.'),
  body:      z.string().describe('Comment body, markdown allowed.'),
})

const ticketReopenArgs = z.object({
  ticket_id: z.string().describe('Ticket id to reopen. Must currently be in done or failed state.'),
})

const ticketTagAddArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current session\'s ticket.'),
  tag:       z.string().describe('Tag to add (lowercase, max 50 chars).'),
})

const ticketTagRemoveArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current session\'s ticket.'),
  tag:       z.string().describe('Tag to remove.'),
})

const agentsListArgs  = z.object({})
const sessionListArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current ticket.'),
})
const connectionListArgs = z.object({})
const thinkArgs        = z.object({
  thought: z.string().describe('The reasoning step.'),
})

// ── Internal API helper ──
// All foundry tools curl back to the service through the sandbox. The
// internal bearer token authenticates the call without needing a user
// session cookie. mount='none' because foundry tools don't need workspace
// state; network=true because they need to reach the host.

async function apiGet(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string) {
  const command = `curl -sf -H "Authorization: Bearer $INTERNAL_TOKEN" "http://host.containers.internal:${ctx.config.port}${path}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      network: true,
      mount:   'none',
      env:     { INTERNAL_TOKEN: ctx.config.internalApiToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

async function apiPost(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string, body: string) {
  const command = `curl -sf -X POST -H "Authorization: Bearer $INTERNAL_TOKEN" -H "Content-Type: application/json" -d ${esc(body)} "http://host.containers.internal:${ctx.config.port}${path}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      network: true,
      mount:   'none',
      env:     { INTERNAL_TOKEN: ctx.config.internalApiToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

async function apiDelete(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string) {
  const command = `curl -sf -X DELETE -H "Authorization: Bearer $INTERNAL_TOKEN" "http://host.containers.internal:${ctx.config.port}${path}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      network: true,
      mount:   'none',
      env:     { INTERNAL_TOKEN: ctx.config.internalApiToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  if (!r.stdout.trim()) return { ok: true }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

// ── Handlers ──

async function handleTicketList(ctx: FoundryCtx, args: z.infer<typeof ticketListArgs>) {
  const qs = new URLSearchParams({ projectId: ctx.projectId })
  if (args.status)   qs.set('status',  args.status)
  if (args.outcome)  qs.set('outcome', args.outcome)
  if (args.agent_id) qs.set('agentId', args.agent_id)
  if (args.tag)      qs.set('tag',     args.tag)
  return apiGet(ctx, 'ticketList', args, `/ticket?${qs}`)
}

async function handleTicketGet(ctx: FoundryCtx, args: z.infer<typeof ticketGetArgs>) {
  const ticket = await apiGet(ctx, 'ticketGet', args, `/ticket/${args.id}`)
  if (ticket.error) return ticket
  const tags = await apiGet(ctx, 'ticketGet', args, `/ticket/${args.id}/tag`)
  return { ...ticket, tags: Array.isArray(tags) ? tags.map((t: any) => t.tag) : [] }
}

async function handleTicketCreate(ctx: FoundryCtx, args: z.infer<typeof ticketCreateArgs>) {
  const payload = JSON.stringify({
    project_id:  ctx.projectId,
    created_by:  ctx.agentName,
    title:       args.title,
    description: args.description,
    priority:    args.priority ?? 0,
    ...(args.agent_id   ? { agent_id:   args.agent_id   } : {}),
    ...(args.depends_on ? { depends_on: args.depends_on } : {}),
  })
  return apiPost(ctx, 'ticketCreate', args, '/ticket', payload)
}

// Verdict is recorded as an activity row of kind='verdict' on the verifier's
// own session. The verify dance reads it back to aggregate pass/fail.
async function handleVerdictReport(ctx: FoundryCtx, args: z.infer<typeof verdictReportArgs>) {
  const { activityInsert } = await import('../database.js')
  activityInsert(ctx.db, {
    session_id:   ctx.sessionId,
    turn_id:      null,
    kind:         'verdict',
    order_index:  0,
    payload:      JSON.stringify({ pass: args.pass, reason: args.reason }),
    tool_use_id:  ctx.toolUseId ?? null,
    execution_id: null,
    tokens_in:    null,
    tokens:       null,
    created_at:   new Date().toISOString(),
  })
  return { ok: true, recorded: { pass: args.pass } }
}

async function handleTicketComment(ctx: FoundryCtx, args: z.infer<typeof ticketCommentArgs>) {
  const targetTicket = args.ticket_id ?? ctx.ticketId
  const payload = JSON.stringify({ author: ctx.agentName, body: args.body })
  return apiPost(ctx, 'ticketComment', args, `/ticket/${targetTicket}/comment`, payload)
}

async function handleTicketReopen(ctx: FoundryCtx, args: z.infer<typeof ticketReopenArgs>) {
  return apiPost(ctx, 'ticketReopen', args, `/ticket/${args.ticket_id}/reopen`, '')
}

async function handleTicketTagAdd(ctx: FoundryCtx, args: z.infer<typeof ticketTagAddArgs>) {
  const ticketId = args.ticket_id ?? ctx.ticketId
  const payload = JSON.stringify({ tag: args.tag })
  return apiPost(ctx, 'ticketTagAdd', args, `/ticket/${ticketId}/tag`, payload)
}

async function handleTicketTagRemove(ctx: FoundryCtx, args: z.infer<typeof ticketTagRemoveArgs>) {
  const ticketId = args.ticket_id ?? ctx.ticketId
  return apiDelete(ctx, 'ticketTagRemove', args, `/ticket/${ticketId}/tag/${encodeURIComponent(args.tag)}`)
}

async function handleAgentsList(ctx: FoundryCtx, _args: z.infer<typeof agentsListArgs>) {
  return apiGet(ctx, 'agentsList', _args, `/agent?accountId=${ctx.accountId}`)
}

async function handleSessionList(ctx: FoundryCtx, args: z.infer<typeof sessionListArgs>) {
  const tid = args.ticket_id ?? ctx.ticketId
  return apiGet(ctx, 'sessionList', args, `/ticket/${tid}/session`)
}

async function handleConnectionList(ctx: FoundryCtx, _args: z.infer<typeof connectionListArgs>) {
  return apiGet(ctx, 'connectionList', _args, `/connection?accountId=${ctx.accountId}`)
}

async function handleThink(ctx: FoundryCtx, args: z.infer<typeof thinkArgs>, tuId?: string) {
  // Think is a no-op but still goes through the sandbox for consistency.
  // The container boots, echoes "ok", dies. Gives a real execution row
  // with timing for how long the model spent on this reasoning step.
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'echo ok', 'think', args, { mount: 'none', toolUseId: tuId ?? ctx.toolUseId })
  return { ok: r.exitCode === 0 }
}

const DESC = {
  ticketList:      'List tickets in the current project. Optionally filter by status (opened/claimed/resolved), outcome (finished/failed/cancelled), assigned agent, or tag.',
  ticketGet:       'Fetch a ticket by id including its title, body, status, outcome, dependency, and tags.',
  ticketCreate:    'Create a new ticket in the current project. Use `depends_on` to sequence work — the new ticket won\'t dispatch until the dependency is resolved with outcome=finished. Use tags for grouping (no parent/child hierarchy).',
  ticketComment:   'Post a comment on a ticket. Used for status updates, questions, or communicating with the Founder.',
  ticketReopen:    'Reopen a resolved ticket so the scheduler dispatches it again. Use this for explicit founder-style re-entry; verifier rejections reopen automatically through the verifier dance.',
  verdictReport:   'Verifier-only. After reviewing the ticket payload + comments, call this exactly once with pass=true if the work meets acceptance criteria, or pass=false with a reason. Producer agents must NOT call this.',
  ticketTagAdd:    'Add a tag to a ticket.',
  ticketTagRemove: 'Remove a tag from a ticket.',
  agentsList:      'List agents configured in the account. Useful for targeting tickets at a specific agent.',
  sessionList:     'List agent sessions for a ticket. Defaults to the current session\'s ticket if omitted.',
  connectionList:  'List configured external connections (LLM backends, integrations). Secrets are masked.',
  think:           'Use this tool to reason, plan, or analyze before taking action. No side effects. Still runs in the sandbox for consistent execution tracking.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: FoundryCtx, allowed?: string[] | '*' | null) {
  // Per-call ctx: stamp the tool_use block id onto a shallow copy so the
  // api helpers (which read ctx.toolUseId) and runCommand write it onto
  // the execution row. Keeping it per-call avoids races when tool calls
  // execute in parallel within a single turn.
  const tu = (extra: unknown): FoundryCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ticketList',    DESC.ticketList,    ticketListArgs.shape,    async (a, x) => asText(await handleTicketList(tu(x), a))),
    sdkTool('ticketGet',     DESC.ticketGet,     ticketGetArgs.shape,     async (a, x) => asText(await handleTicketGet(tu(x), a))),
    sdkTool('ticketCreate',  DESC.ticketCreate,  ticketCreateArgs.shape,  async (a, x) => asText(await handleTicketCreate(tu(x), a))),
    sdkTool('ticketComment', DESC.ticketComment, ticketCommentArgs.shape, async (a, x) => asText(await handleTicketComment(tu(x), a))),
    sdkTool('ticketReopen',  DESC.ticketReopen,  ticketReopenArgs.shape,  async (a, x) => asText(await handleTicketReopen(tu(x), a))),
    sdkTool('verdictReport', DESC.verdictReport, verdictReportArgs.shape, async (a, x) => asText(await handleVerdictReport(tu(x), a))),
    sdkTool('ticketTagAdd',    DESC.ticketTagAdd,    ticketTagAddArgs.shape,    async (a, x) => asText(await handleTicketTagAdd(tu(x), a))),
    sdkTool('ticketTagRemove', DESC.ticketTagRemove, ticketTagRemoveArgs.shape, async (a, x) => asText(await handleTicketTagRemove(tu(x), a))),
    sdkTool('agentsList',    DESC.agentsList,    agentsListArgs.shape,    async (a, x) => asText(await handleAgentsList(tu(x), a))),
    sdkTool('sessionList',   DESC.sessionList,   sessionListArgs.shape,   async (a, x) => asText(await handleSessionList(tu(x), a))),
    sdkTool('connectionList', DESC.connectionList, connectionListArgs.shape, async (a, x) => asText(await handleConnectionList(tu(x), a))),
    sdkTool('think',         DESC.think,         thinkArgs.shape,         async (a, x) => asText(await handleThink(tu(x), a))),
  ]
  return createSdkMcpServer({ name: 'foundry', tools: filterTools(all, allowed) })
}
// ── Vercel ai SDK adapter ──

export function buildAi(ctx: FoundryCtx) {
  return {
    ticketList: tool({
      description: DESC.ticketList,
      inputSchema: ticketListArgs,
      execute:     (args: z.infer<typeof ticketListArgs>) => handleTicketList(ctx, args),
    }),
    ticketGet: tool({
      description: DESC.ticketGet,
      inputSchema: ticketGetArgs,
      execute:     (args: z.infer<typeof ticketGetArgs>) => handleTicketGet(ctx, args),
    }),
    ticketCreate: tool({
      description: DESC.ticketCreate,
      inputSchema: ticketCreateArgs,
      execute:     (args: z.infer<typeof ticketCreateArgs>) => handleTicketCreate(ctx, args),
    }),
    ticketComment: tool({
      description: DESC.ticketComment,
      inputSchema: ticketCommentArgs,
      execute:     (args: z.infer<typeof ticketCommentArgs>) => handleTicketComment(ctx, args),
    }),
    ticketReopen: tool({
      description: DESC.ticketReopen,
      inputSchema: ticketReopenArgs,
      execute:     (args: z.infer<typeof ticketReopenArgs>) => handleTicketReopen(ctx, args),
    }),
    verdictReport: tool({
      description: DESC.verdictReport,
      inputSchema: verdictReportArgs,
      execute:     (args: z.infer<typeof verdictReportArgs>) => handleVerdictReport(ctx, args),
    }),
    ticketTagAdd: tool({
      description: DESC.ticketTagAdd,
      inputSchema: ticketTagAddArgs,
      execute:     (args: z.infer<typeof ticketTagAddArgs>) => handleTicketTagAdd(ctx, args),
    }),
    ticketTagRemove: tool({
      description: DESC.ticketTagRemove,
      inputSchema: ticketTagRemoveArgs,
      execute:     (args: z.infer<typeof ticketTagRemoveArgs>) => handleTicketTagRemove(ctx, args),
    }),
    agentsList: tool({
      description: DESC.agentsList,
      inputSchema: agentsListArgs,
      execute:     (args: z.infer<typeof agentsListArgs>) => handleAgentsList(ctx, args),
    }),
    sessionList: tool({
      description: DESC.sessionList,
      inputSchema: sessionListArgs,
      execute:     (args: z.infer<typeof sessionListArgs>) => handleSessionList(ctx, args),
    }),
    connectionList: tool({
      description: DESC.connectionList,
      inputSchema: connectionListArgs,
      execute:     (args: z.infer<typeof connectionListArgs>) => handleConnectionList(ctx, args),
    }),
    think: tool({
      description: DESC.think,
      inputSchema: thinkArgs,
      execute:     (args: z.infer<typeof thinkArgs>) => handleThink(ctx, args),
    }),
  }
}
