// Cross-module surface for @foundry/mcp. Only the agent-facing list is
// exposed — vendor providers and tool servers (foundryServer, sandboxServer,
// browserServer, githubServer, byConnectionKind, etc.) are infra the engine
// composition root wires directly, not anything routes call.

import type { Ctx, Result, McpError } from '@foundry/model'

export type McpListEntry = {
  id:          string
  name:        string
  category:    string
  description: string
  tools:       Array<{ name: string; description: string }>
}

export type McpSlice = {
  agentMcpList: (ctx: Ctx) => Promise<Result<McpListEntry[], McpError>>
}
