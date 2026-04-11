// Foundry harness introspection server. Exposes read-mostly access to the
// Foundry DB: tickets, agents, sessions, providers. Also hosts `think`,
// the no-side-effect scratch reasoning tool.
//
// Structure: handler functions are SDK-agnostic. buildSdk wraps them as
// Anthropic Claude Agent SDK tools. buildAi wraps them as Vercel ai SDK
// tools. Both runners consume the same handlers.
//
// Tools call domain.* functions directly rather than curl'ing the service
// HTTP API — the MCP server is an in-process component of the service and
// shares the same trust level.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import type { Db } from '../database.js'
import * as domain from '../domain.js'
import { asText } from './_shared.js'

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'foundry',
  name:        'Foundry',
  description: 'Foundry harness introspection: tickets, agents, sessions, providers.',
  tools: [
    { name: 'ticketList',    description: 'List tickets in the current project.' },
    { name: 'ticketGet',     description: 'Fetch a ticket by id.' },
    { name: 'ticketCreate',  description: 'Create a new ticket in the current project.' },
    { name: 'ticketComment', description: 'Post a comment on a ticket.' },
    { name: 'agentsList',    description: 'List agents configured in the current project.' },
    { name: 'sessionList',   description: 'List agent sessions for a ticket.' },
    { name: 'providerList',  description: 'List configured LLM providers.' },
    { name: 'think',         description: 'Scratch reasoning pad. No side effects.' },
  ],
}

export interface FoundryCtx {
  db:         Db
  projectId:  string
  ticketId:   string   // parent ticket for the session — used as parent_id when agent creates sub-tickets
  agentName:  string   // used as author of comments and created_by for new tickets
}

// ── Schemas ──

const ticketListArgs = z.object({
  status:   z.string().optional().describe('Filter by status (open, claimed, done, failed, blocked).'),
  agent_id: z.string().optional().describe('Filter by assigned agent id.'),
})

const ticketGetArgs = z.object({
  id: z.string().describe('Ticket id.'),
})

const ticketCreateArgs = z.object({
  title:    z.string().describe('Short title.'),
  body:     z.string().describe('Full description, markdown allowed.'),
  agent_id: z.string().optional().describe('Optional: assign to a specific agent by id. Use agentsList first to discover ids.'),
  priority: z.number().int().optional().describe('Optional priority (default 0).'),
})

const ticketCommentArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket to comment on. Defaults to the current session\'s ticket.'),
  body:      z.string().describe('Comment body, markdown allowed.'),
})

const agentsListArgs  = z.object({})
const sessionListArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current ticket.'),
})
const providerListArgs = z.object({})
const thinkArgs        = z.object({
  thought: z.string().describe('The reasoning step.'),
})

// ── Handlers ──

async function handleTicketList(ctx: FoundryCtx, args: z.infer<typeof ticketListArgs>) {
  try {
    return domain.ticketList(ctx.db, {
      projectId: ctx.projectId,
      ...(args.status   ? { status:  args.status   } : {}),
      ...(args.agent_id ? { agentId: args.agent_id } : {}),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleTicketGet(ctx: FoundryCtx, args: z.infer<typeof ticketGetArgs>) {
  try {
    return domain.ticketGet(ctx.db, args.id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleTicketCreate(ctx: FoundryCtx, args: z.infer<typeof ticketCreateArgs>) {
  try {
    return domain.ticketCreate(ctx.db, {
      project_id: ctx.projectId,
      parent_id:  ctx.ticketId,
      created_by: ctx.agentName,
      title:      args.title,
      body:       args.body,
      priority:   args.priority ?? 0,
      ...(args.agent_id ? { agent_id: args.agent_id } : {}),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleTicketComment(ctx: FoundryCtx, args: z.infer<typeof ticketCommentArgs>) {
  try {
    const targetTicket = args.ticket_id ?? ctx.ticketId
    return domain.commentCreate(ctx.db, targetTicket, {
      author: ctx.agentName,
      body:   args.body,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleAgentsList(ctx: FoundryCtx, _args: z.infer<typeof agentsListArgs>) {
  try {
    return domain.agentList(ctx.db, { projectId: ctx.projectId })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleSessionList(ctx: FoundryCtx, args: z.infer<typeof sessionListArgs>) {
  try {
    return domain.sessionByTicket(ctx.db, args.ticket_id ?? ctx.ticketId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleProviderList(ctx: FoundryCtx, _args: z.infer<typeof providerListArgs>) {
  try {
    return domain.providerList(ctx.db)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleThink(_ctx: FoundryCtx, _args: z.infer<typeof thinkArgs>) {
  return { ok: true }
}

const DESC = {
  ticketList:    'List tickets in the current project. Optionally filter by status or assigned agent.',
  ticketGet:     'Fetch a ticket by id, including its title, body, status, and parent chain.',
  ticketCreate:  'Create a new ticket in the current project. The new ticket is parented to the current session\'s ticket by default, so sub-tasks chain back to the originating work.',
  ticketComment: 'Post a comment on a ticket. Used for status updates, questions, or communicating with the founder.',
  agentsList:    'List agents configured in the current project. Useful for targeting sub-tickets at a specific agent.',
  sessionList:   'List agent sessions for a ticket. Defaults to the current session\'s ticket if omitted.',
  providerList:  'List configured LLM providers (model backends). Secrets are masked.',
  think:         'Use this tool to reason, plan, or analyze before taking action. No side effects.',
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
      sdkTool('agentsList',    DESC.agentsList,    agentsListArgs.shape,    async a => asText(await handleAgentsList(ctx, a))),
      sdkTool('sessionList',   DESC.sessionList,   sessionListArgs.shape,   async a => asText(await handleSessionList(ctx, a))),
      sdkTool('providerList',  DESC.providerList,  providerListArgs.shape,  async a => asText(await handleProviderList(ctx, a))),
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
    providerList: tool({
      description: DESC.providerList,
      inputSchema: providerListArgs,
      execute:     (args: z.infer<typeof providerListArgs>) => handleProviderList(ctx, args),
    }),
    think: tool({
      description: DESC.think,
      inputSchema: thinkArgs,
      execute:     (args: z.infer<typeof thinkArgs>) => handleThink(ctx, args),
    }),
  }
}
