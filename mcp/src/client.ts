// Cross-service contract for @foundry/mcp. Types only — no value imports
// beyond schema.ts and @foundry/model. Vendor providers and tool servers
// (foundryServer, sandboxServer, browserServer, githubServer,
// byConnectionKind, etc.) are infra the engine composition root wires
// directly, not anything other services call through this client.

import type { Ctx, Result } from '@foundry/model'

import type { McpListEntry, McpError } from './schema.js'

export type McpClient = {
  agentMcpList: (ctx: Ctx) => Promise<Result<McpListEntry[], McpError>>
}
