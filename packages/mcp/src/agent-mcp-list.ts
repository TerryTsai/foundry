// MCP server catalog surfaced to the agent-edit UI. Returns the built-ins
// plus one synthesized entry per account connection whose kind has a
// matching MCP module. The id/key (`<kind>:<name>`) is the same one the
// runtime uses when mounting the Agent-SDK server.

import { type Db } from '@foundry/db'
import type { Connection } from '@foundry/db'
import * as providers from './integrations/registry.js'
import { registry as mcpRegistry } from './tools/registry.js'
import { byConnectionKind } from './integrations/registry.js'
import * as foundryMcp from './tools/foundry.js'
import * as githubMcp  from './integrations/github/tools.js'
import * as sandboxMcp from './tools/sandbox.js'
import * as browserMcp from './tools/browser.js'

import type { McpListEntry, ConnectionByAccountFn } from './types.js'

// Re-export so existing imports through @foundry/mcp/agent-mcp-list keep
// working without touching the public surface.
export type { ConnectionByAccountFn } from './types.js'

export function agentMcpList(
  db: Db, accountId: string, connectionByAccount: ConnectionByAccountFn,
): McpListEntry[] {
  const builtIns = builtInEntries()
  const conns = connectionByAccount(db, accountId)
  return [...builtIns, ...connectionEntries(conns)]
}

function builtInEntries(): McpListEntry[] {
  const builtInTools: Record<string, { name: string; description: string }[]> = {
    foundry: foundryMcp.tools.map(toolInfo),
    github:  githubMcp.tools.map(toolInfo),
    sandbox: sandboxMcp.tools.map(toolInfo),
    browser: browserMcp.tools.map(toolInfo),
  }
  return mcpRegistry.map(info => ({ ...info, tools: builtInTools[info.id] ?? [] }))
}

function toolInfo(t: { name: string; description: string }): { name: string; description: string } {
  return { name: t.name, description: t.description }
}

function connectionEntries(conns: Connection[]): McpListEntry[] {
  const out: McpListEntry[] = []
  for (const conn of conns) {
    const entry = entryForConnection(conn)
    if (entry) out.push(entry)
  }
  return out
}

function entryForConnection(conn: Connection): McpListEntry | null {
  const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
  const provider = providers.providerGet(conn.kind)
  if (!mod || !provider) return null
  return {
    id:          `${provider.kind}:${conn.name}`,
    name:        `${provider.name} · ${conn.name}`,
    category:    mod.info.category,
    description: `Connection-backed tools from ${provider.name} (${conn.name}).`,
    tools:       mod.tools.map(t => ({ name: t.name, description: t.description })),
  }
}
