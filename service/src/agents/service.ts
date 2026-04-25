import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import * as providers from '../integrations/registry.js'
import { registry as mcpRegistry } from '../reconciler/session/tools/registry.js'
import { byConnectionKind } from '../integrations/registry.js'
import * as foundryMcp from '../reconciler/session/tools/foundry.js'
import * as githubMcp  from '../integrations/github/tools.js'
import * as sandboxMcp from '../reconciler/session/tools/sandbox.js'
import * as browserMcp from '../reconciler/session/tools/browser.js'

// MCP server catalog surfaced to the agent-edit UI. Returns the built-ins
// plus one synthesized entry per account connection whose kind has a
// matching MCP module. The id/key (`<kind>:<name>`) is the same one the
// runtime uses when mounting the Agent-SDK server.
//
// Lives here (not in @foundry/crud) because it depends on tool registries
// from reconciler/session/tools/ and integrations/. Phase 5+ will move
// this onto a typed client surface; for now the route handler imports it
// directly.
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

export function agentMcpList(db: Db, accountId: string): McpListEntry[] {
  const out: McpListEntry[] = mcpRegistry.map(info => ({
    ...info,
    tools: builtInTools[info.id] ?? [],
  }))
  const conns = database.connectionByAccount(db, accountId)
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    const provider = providers.providerGet(conn.kind)
    if (!mod || !provider) continue
    out.push({
      id:          `${provider.kind}:${conn.name}`,
      name:        `${provider.name} · ${conn.name}`,
      category:    mod.info.category,
      description: `Connection-backed tools from ${provider.name} (${conn.name}).`,
      tools:       mod.tools.map(t => ({ name: t.name, description: t.description })),
    })
  }
  return out
}
