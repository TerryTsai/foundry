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
import { asText, esc, runCommand } from './_shared.js'

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'foundry',
  name:        'Foundry',
  description: 'Foundry harness introspection: tickets, agents, sessions, connections.',
  tools: [
    { name: 'ticketList',    description: 'List tickets in the current project.' },
    { name: 'ticketGet',     description: 'Fetch a ticket by id.' },
    { name: 'ticketCreate',  description: 'Create a new ticket in the current project.' },
    { name: 'ticketComment', description: 'Post a comment on a ticket.' },
    { name: 'ticketTagAdd',    description: 'Add a tag to a ticket.' },
    { name: 'ticketTagRemove', description: 'Remove a tag from a ticket.' },
    { name: 'agentsList',    description: 'List agents configured in the current project.' },
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
}

// ── Schemas ──

const ticketListArgs = z.object({
  status:   z.string().optional().describe('Filter by status (open, claimed, done, failed, blocked).'),
  agent_id: z.string().optional().describe('Filter by assigned agent id.'),
  tag:      z.string().optional().describe('Filter by tag.'),
})

const ticketGetArgs = z.object({
  id: z.string().describe('Ticket id.'),
})

const ticketCreateArgs = z.object({
  title:      z.string().describe('Short title.'),
  body:       z.string().describe('Full description, markdown allowed.'),
  agent_id:   z.string().optional().describe('Optional: assign to a specific agent by id. Use agentsList first to discover ids.'),
  priority:   z.number().int().optional().describe('Optional priority (default 0).'),
  blocked_by: z.string().optional().describe('Optional: ticket id this new ticket depends on. Scheduler will not dispatch until that ticket is done. Use to sequence dependent work.'),
})

const ticketCommentArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket to comment on. Defaults to the current session\'s ticket.'),
  body:      z.string().describe('Comment body, markdown allowed.'),
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
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  if (!r.stdout.trim()) return { ok: true }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

// ── Handlers ──

async function handleTicketList(ctx: FoundryCtx, args: z.infer<typeof ticketListArgs>) {
  const qs = new URLSearchParams({ projectId: ctx.projectId })
  if (args.status)   qs.set('status', args.status)
  if (args.agent_id) qs.set('agentId', args.agent_id)
  if (args.tag)      qs.set('tag', args.tag)
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
    project_id: ctx.projectId,
    parent_id:  ctx.ticketId,
    created_by: ctx.agentName,
    title:      args.title,
    body:       args.body,
    priority:   args.priority ?? 0,
    ...(args.agent_id   ? { agent_id:   args.agent_id   } : {}),
    ...(args.blocked_by ? { blocked_by: args.blocked_by } : {}),
  })
  return apiPost(ctx, 'ticketCreate', args, '/ticket', payload)
}

async function handleTicketComment(ctx: FoundryCtx, args: z.infer<typeof ticketCommentArgs>) {
  const targetTicket = args.ticket_id ?? ctx.ticketId
  const payload = JSON.stringify({ author: ctx.agentName, body: args.body })
  return apiPost(ctx, 'ticketComment', args, `/ticket/${targetTicket}/comment`, payload)
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

async function handleThink(ctx: FoundryCtx, args: z.infer<typeof thinkArgs>) {
  // Think is a no-op but still goes through the sandbox for consistency.
  // The container boots, echoes "ok", dies. Gives a real execution row
  // with timing for how long the model spent on this reasoning step.
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'echo ok', 'think', args, { mount: 'none' })
  return { ok: r.exitCode === 0 }
}

const DESC = {
  ticketList:      'List tickets in the current project. Optionally filter by status, assigned agent, or tag.',
  ticketGet:       'Fetch a ticket by id, including its title, body, status, and parent chain.',
  ticketCreate:    'Create a new ticket in the current project. The new ticket is parented to the current session\'s ticket by default, so sub-tasks chain back to the originating work.',
  ticketComment:   'Post a comment on a ticket. Used for status updates, questions, or communicating with the Founder.',
  ticketTagAdd:    'Add a tag to a ticket.',
  ticketTagRemove: 'Remove a tag from a ticket.',
  agentsList:      'List agents configured in the current project. Useful for targeting sub-tickets at a specific agent.',
  sessionList:   'List agent sessions for a ticket. Defaults to the current session\'s ticket if omitted.',
  connectionList:  'List configured external connections (LLM backends, integrations). Secrets are masked.',
  think:         'Use this tool to reason, plan, or analyze before taking action. No side effects. Still runs in the sandbox for consistent execution tracking.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: FoundryCtx) {
  return createSdkMcpServer({
    name: 'foundry',
    tools: [
      sdkTool('ticketList',    DESC.ticketList,    ticketListArgs.shape,    async a => asText(await handleTicketList(ctx, a))),
      sdkTool('ticketGet',     DESC.ticketGet,     ticketGetArgs.shape,     async a => asText(await handleTicketGet(ctx, a))),
      sdkTool('ticketCreate',  DESC.ticketCreate,  ticketCreateArgs.shape,  async a => asText(await handleTicketCreate(ctx, a))),
      sdkTool('ticketComment', DESC.ticketComment, ticketCommentArgs.shape, async a => asText(await handleTicketComment(ctx, a))),
      sdkTool('ticketTagAdd',    DESC.ticketTagAdd,    ticketTagAddArgs.shape,    async a => asText(await handleTicketTagAdd(ctx, a))),
      sdkTool('ticketTagRemove', DESC.ticketTagRemove, ticketTagRemoveArgs.shape, async a => asText(await handleTicketTagRemove(ctx, a))),
      sdkTool('agentsList',    DESC.agentsList,    agentsListArgs.shape,    async a => asText(await handleAgentsList(ctx, a))),
      sdkTool('sessionList',   DESC.sessionList,   sessionListArgs.shape,   async a => asText(await handleSessionList(ctx, a))),
      sdkTool('connectionList', DESC.connectionList, connectionListArgs.shape, async a => asText(await handleConnectionList(ctx, a))),
      sdkTool('think',         DESC.think,         thinkArgs.shape,         async a => asText(await handleThink(ctx, a))),
    ],
  })
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
