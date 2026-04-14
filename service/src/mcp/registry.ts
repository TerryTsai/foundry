// MCP server registry — metadata only. Each agent session spawns zero or
// more of these servers in-process and passes them to the Claude Agent SDK
// via `query({ mcpServers: {...} })`. The metadata here drives the agent
// configuration UI (nested multi-select) and the shape of `agent.tools`.
//
// Runtime behavior (actual tool implementations, lifecycle hooks, state)
// lives in the individual server modules. This file is the flat index.

import { info as foundry } from './foundry.js'
import { info as github  } from './github.js'
import { info as sandbox } from './sandbox.js'
import { info as browser } from './browser.js'

export const SERVER_IDS = ['foundry', 'github', 'sandbox', 'browser'] as const
export type  McpServerId = typeof SERVER_IDS[number]

export interface McpToolInfo {
  name:        string
  description: string
}

export interface McpServerInfo {
  id:          McpServerId
  name:        string
  description: string
  tools:       McpToolInfo[]
}

// Agent tool selection shape. `null` means "all servers, all tools".
// Omitting a server key means that server isn't attached. `'*'` under a
// server means all tools from that server; a string[] limits to named
// tools. Built-in servers use the McpServerId keys; connection-contributed
// servers use dynamic `conn:<connection_name>` keys — so the type is
// intentionally open.
export type McpToolSelection = Partial<Record<McpServerId, string[] | '*'>> & {
  [key: string]: string[] | '*' | undefined
} | null

export const registry: McpServerInfo[] = [foundry, github, sandbox, browser]

export function registryGet(id: McpServerId): McpServerInfo | undefined {
  return registry.find(s => s.id === id)
}

// Flat list of tool names across all servers. Used by the legacy
// GET /tools endpoint that the current web UI consumes for agent tool
// selection. Will be replaced by GET /mcp (nested shape) in a later pass.
export const TOOL_NAMES: readonly string[] = registry.flatMap(s => s.tools.map(t => t.name))

// Filter a server's tool array by the agent's allowed selection. null / '*'
// means all tools pass through. An explicit string[] keeps only tools whose
// names appear in the list. Each server's buildSdk pipes its constructed
// tools through this so tool access is enforced server-side, not just in
// the UI selector.
export function filterTools<T extends { name: string }>(tools: T[], allowed: string[] | '*' | null | undefined): T[] {
  if (allowed == null || allowed === '*') return tools
  return tools.filter(t => allowed.includes(t.name))
}

// Parse the JSON stored in agent.tools into an McpToolSelection. A null /
// empty / malformed value is treated as "all servers, all tools" so agents
// configured before this wiring existed keep working.
export function parseToolSelection(raw: string | null | undefined): McpToolSelection {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed as McpToolSelection : null
  } catch { return null }
}
