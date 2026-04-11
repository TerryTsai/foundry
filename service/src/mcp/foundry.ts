// Foundry harness introspection server. Exposes read-mostly access to the
// Foundry DB: tickets, agents, sessions, providers. Also hosts `think`,
// the no-side-effect scratch reasoning tool, because agent cognition is a
// harness concern and `think` has no external dependency.
//
// Tools call domain.* functions directly rather than curl'ing the service
// HTTP API — the MCP server is an in-process component of the service and
// shares the same trust level. This also sidesteps the sandbox-to-host
// auth issue that motivated the rogue-agent incident (RCA-001).
//
// The old flat `ticket` tool with an `action: read|list|create` discriminator
// is split into four explicit tools (`ticketList`, `ticketGet`, `ticketCreate`,
// `ticketComment`) so agents can be configured with a narrower surface.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Db } from '../database.js'
import * as domain from '../domain.js'
import { asText } from '../runtime/tool.js'

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

export function build(ctx: FoundryCtx) {
  const { db, projectId, ticketId, agentName } = ctx

  return createSdkMcpServer({
    name: 'foundry',
    tools: [

      sdkTool(
        'ticketList',
        'List tickets in the current project. Optionally filter by status or assigned agent.',
        {
          status:   z.string().optional().describe('Filter by status (open, claimed, done, failed, blocked).'),
          agent_id: z.string().optional().describe('Filter by assigned agent id.'),
        },
        async (args) => {
          try {
            const tickets = domain.ticketList(db, {
              projectId,
              ...(args.status   ? { status:  args.status   } : {}),
              ...(args.agent_id ? { agentId: args.agent_id } : {}),
            })
            return asText(tickets)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'ticketGet',
        'Fetch a ticket by id, including its title, body, status, and parent chain.',
        { id: z.string().describe('Ticket id.') },
        async (args) => {
          try {
            const ticket = domain.ticketGet(db, args.id)
            return asText(ticket)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'ticketCreate',
        'Create a new ticket in the current project. The new ticket is parented to the current session\'s ticket by default, so sub-tasks chain back to the originating work.',
        {
          title:    z.string().describe('Short title.'),
          body:     z.string().describe('Full description, markdown allowed.'),
          agent_id: z.string().optional().describe('Optional: assign to a specific agent by id. Use agentsList first to discover ids.'),
          priority: z.number().int().optional().describe('Optional priority (default 0).'),
        },
        async (args) => {
          try {
            const ticket = domain.ticketCreate(db, {
              project_id: projectId,
              parent_id:  ticketId,
              created_by: agentName,
              title:      args.title,
              body:       args.body,
              priority:   args.priority ?? 0,
              ...(args.agent_id ? { agent_id: args.agent_id } : {}),
            })
            return asText(ticket)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'ticketComment',
        'Post a comment on a ticket. Used for status updates, questions, or communicating with the founder.',
        {
          ticket_id: z.string().describe('Ticket to comment on. Defaults to the current session\'s ticket if omitted.').optional(),
          body:      z.string().describe('Comment body, markdown allowed.'),
        },
        async (args) => {
          try {
            const targetTicket = args.ticket_id ?? ticketId
            const comment = domain.commentCreate(db, targetTicket, {
              author: agentName,
              body:   args.body,
            })
            return asText(comment)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'agentsList',
        'List agents configured in the current project. Useful for targeting sub-tickets at a specific agent.',
        {},
        async () => {
          try {
            const agents = domain.agentList(db, { projectId })
            return asText(agents)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'sessionList',
        'List agent sessions for a ticket. Defaults to the current session\'s ticket if omitted.',
        { ticket_id: z.string().optional().describe('Ticket id. Defaults to the current ticket.') },
        async (args) => {
          try {
            const sessions = domain.sessionByTicket(db, args.ticket_id ?? ticketId)
            return asText(sessions)
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'providerList',
        'List configured LLM providers (model backends). Secrets are masked.',
        {},
        async () => {
          try {
            return asText(domain.providerList(db))
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'think',
        'Use this tool to reason, plan, or analyze before taking action. No side effects.',
        { thought: z.string().describe('The reasoning step.') },
        async () => asText({ ok: true }),
      ),

    ],
  })
}
