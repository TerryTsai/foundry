// Built-in MCP server registry. The four servers below ship with Foundry
// (they don't depend on a user-stored connection):
//   foundry  — back-channel into the Foundry HTTP API (sb_ JWT auth)
//   github   — git ops via GitHub App installation token (host config)
//   sandbox  — exec/read/write/patch/search/find inside the per-session container
//   browser  — fetch/scrape over the network
//
// Vendor servers (cloudflare, aws, …) live in integrations/<vendor>/tools.ts
// and are surfaced through integrations/registry.ts → byConnectionKind.

import * as foundry from './foundry.js'
import * as sandbox from './sandbox.js'
import * as browser from './browser.js'
import * as github  from '../integrations/github/tools.js'   // collocated with github auth helpers; treated as a built-in here

import type { McpServerInfo, McpToolSelection } from '../types.js'

export const builtIns = { foundry, github, sandbox, browser }

export const registry: McpServerInfo[] = [foundry.info, github.info, sandbox.info, browser.info]

export function registryGet(id: string): McpServerInfo | undefined {
  return registry.find(s => s.id === id)
}

export const TOOL_NAMES: readonly string[] = [
  ...foundry.tools, ...github.tools, ...sandbox.tools, ...browser.tools,
].map(t => t.name)

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
