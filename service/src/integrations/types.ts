// Shared types for the integrations layer. Both the connection-provider
// definition (the credential schema) and the MCP tool definition live
// here so vendor folders can import a single types module.

import type { ZodType } from 'zod'

// ── Provider (credential definitions) ──────────────────────────────

export interface CredentialField {
  key:          string
  label:        string
  type:         'text' | 'password' | 'select' | 'textarea'
  placeholder?: string
  options?:     string[]    // for 'select'
  required?:    boolean     // default true
  help?:        string      // small text rendered under the field
}

export interface ConnectionProvider {
  kind:         string
  name:         string
  credentials:  CredentialField[]

  // Server-side validation beyond field presence. Receives decoded
  // secrets + config. Return null for OK, a string message for rejection.
  validate?:    (secrets: Record<string, unknown>, config: Record<string, unknown>) => string | null
}

// ── MCP tools (what an agent can invoke) ───────────────────────────

export interface ToolDef {
  name:        string
  description: string
  schema:      ZodType
  handler:     (ctx: any, args: any) => any
}

export type McpCategory = 'core' | 'code' | 'infra' | 'data' | 'product' | 'growth'

// id is open-typed because connection-backed servers use dynamic
// `<kind>:<connection_name>` keys at runtime; the static built-in ids
// are: foundry | github | sandbox | browser.
export interface McpServerInfo {
  id:          string
  name:        string
  description: string
  category:    McpCategory
}

// Agent tool selection shape. `null` means "all servers, all tools".
// Omitting a server key means that server isn't attached. `'*'` under a
// server means all tools from that server; a string[] limits to named
// tools.
export type McpToolSelection = Record<string, string[] | '*'> | null
