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

interface McpListEntry {
  id: string; name: string; category: string; description: string
  tools: Array<{ name: string; description: string }>
}

const builtInTools: Record<string, { name: string; description: string }[]> = {
  foundry: foundryMcp.tools.map(t => ({ name: t.name, description: t.description })),
  github:  githubMcp.tools.map(t  => ({ name: t.name, description: t.description })),
  sandbox: sandboxMcp.tools.map(t => ({ name: t.name, description: t.description })),
  browser: browserMcp.tools.map(t => ({ name: t.name, description: t.description })),
}

// mcp can't import @foundry/crud — composition root injects this lookup.
export type ConnectionByAccountFn = (db: Db, accountId: string) => Connection[]

export function agentMcpList(
  db: Db, accountId: string, connectionByAccount: ConnectionByAccountFn,
): McpListEntry[] {
  const builtIns = builtInEntries()
  const conns = connectionByAccount(db, accountId)
  return [...builtIns, ...connectionEntries(conns)]
}

function builtInEntries(): McpListEntry[] {
  return mcpRegistry.map(info => ({ ...info, tools: builtInTools[info.id] ?? [] }))
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
