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

// Agent tool selection shape. `null` means "all servers, all tools". Omitting
// a server id means that server is not attached. An empty array under a
// server means the server is attached but zero tools are enabled (valid but
// unusual). `"*"` under a server means all tools from that server.
export type McpToolSelection = { [K in McpServerId]?: string[] | '*' } | null

export const registry: McpServerInfo[] = [foundry, github, sandbox, browser]

export function registryGet(id: McpServerId): McpServerInfo | undefined {
  return registry.find(s => s.id === id)
}

// Flat list of tool names across all servers. Used by the legacy
// GET /tools endpoint that the current web UI consumes for agent tool
// selection. Will be replaced by GET /mcp (nested shape) in a later pass.
export const TOOL_NAMES: readonly string[] = registry.flatMap(s => s.tools.map(t => t.name))
