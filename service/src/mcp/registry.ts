// MCP server registry. Two groups:
//
//   builtIns      — one instance per agent session (foundry/github/sandbox/browser).
//   byConnectionKind — one instance per connection row of a matching kind
//                      (e.g. cloudflare). Mounted as `<kind>:<connection.name>`.
//
// Each server module exports `info` (metadata for the agent-tool-selection
// UI), `buildSdk(ctx, allowed?)` (Claude Agent SDK adapter), and
// `buildAi(ctx)` (Vercel ai SDK adapter).

import * as foundry     from './foundry.js'
import * as github      from './github.js'
import * as sandbox     from './sandbox.js'
import * as browser     from './browser.js'
import * as cloudflare  from './cloudflare.js'
import * as aws         from './aws.js'
import * as resend      from './resend.js'
import * as posthog     from './posthog.js'
import * as sentry      from './sentry.js'
import * as supabase    from './supabase.js'
import * as clerk       from './clerk.js'
import * as stripe      from './stripe.js'
import * as linear      from './linear.js'
import * as uptimerobot from './uptimerobot.js'
import * as calcom      from './calcom.js'
import * as crisp       from './crisp.js'

export const builtIns = { foundry, github, sandbox, browser }

export const byConnectionKind = {
  cloudflare, aws, resend, posthog, sentry, supabase,
  clerk, stripe, linear, uptimerobot, calcom, crisp,
}

export const SERVER_IDS = [
  'foundry', 'github', 'sandbox', 'browser',
  'cloudflare', 'aws', 'resend', 'posthog', 'sentry', 'supabase',
  'clerk', 'stripe', 'linear', 'uptimerobot', 'calcom', 'crisp',
] as const
export type  McpServerId = typeof SERVER_IDS[number]

export interface McpToolInfo {
  name:        string
  description: string
}

export interface ToolDef {
  name:        string
  description: string
  schema:      import('zod').ZodType
  handler:     (ctx: any, args: any) => any
}

// Category buckets used by the agent-tool-selection UI to group rows.
// Keep the set small — it's the skim-level grouping a founder sees when
// picking tools for a new agent.
export type McpCategory = 'core' | 'code' | 'infra' | 'data' | 'product' | 'growth'

export interface McpServerInfo {
  id:          McpServerId
  name:        string
  description: string
  category:    McpCategory
  tools:       McpToolInfo[]
}

// Agent tool selection shape. `null` means "all servers, all tools".
// Omitting a server key means that server isn't attached. `'*'` under a
// server means all tools from that server; a string[] limits to named
// tools. Built-in servers use the McpServerId keys; connection-backed
// servers use dynamic `<kind>:<connection_name>` keys — so the type is
// intentionally open.
export type McpToolSelection = Partial<Record<McpServerId, string[] | '*'>> & {
  [key: string]: string[] | '*' | undefined
} | null

// Built-in metadata index. Connection-backed servers are surfaced
// dynamically per-account via domain/agents::agentMcpList.
export const registry: McpServerInfo[] = [foundry.info, github.info, sandbox.info, browser.info]

export function registryGet(id: McpServerId): McpServerInfo | undefined {
  return registry.find(s => s.id === id)
}

// Flat list of tool names across built-in servers. Used by the legacy
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
