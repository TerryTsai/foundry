// Foundry harness introspection server. Exposes read-mostly access to the
// Foundry DB: tickets, agents, sessions, providers. Also hosts `think`,
// the no-side-effect scratch reasoning tool, because agent cognition is a
// harness concern and `think` has no external dependency.
//
// Implementation note: this is metadata-only for now. The actual MCP server
// factory (createSdkMcpServer + sdkTool wiring) will land in a later commit
// alongside the migration of tool logic out of runtime/tool.ts.

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
    { name: 'sessionList',   description: 'List agent sessions, optionally filtered by ticket.' },
    { name: 'providerList',  description: 'List configured LLM providers.' },
    { name: 'think',         description: 'Scratch reasoning pad. No side effects.' },
  ],
}
