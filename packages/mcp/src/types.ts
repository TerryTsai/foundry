// Module-internal types for @foundry/mcp. Shared across the four built-in
// tool servers and the per-vendor connection-bound tool modules.

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

// Method-syntax `handler` triggers TS's bivariant parameter checking,
// which lets each tool's specific zod-inferred args type fit through the
// shared `unknown` slot without per-handler casts. Validation still happens
// at the SDK boundary against the zod schema before the handler runs.
export interface ToolDef<TCtx = unknown> {
  name:        string
  description: string
  schema:      ZodType
  handler(ctx: TCtx, args: unknown): Promise<unknown> | unknown
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

// ── Config (minimal slice the MCP layer uses) ─────────────────────
// The route layer / composition root passes the full service Config; TS
// structural typing makes that compatible with this minimal shape.

export interface McpConfig {
  port:                     number
  sandboxImage:             string
  sandboxTimeout:           number
  sandboxMemoryMb:          number
  sandboxCpus:              number
  sandboxPidsLimit:         number
  sandboxNofileSoft:        number
  sandboxNofileHard:        number
  sandboxTmpfsMb:           number
  internalApiToken:         string
  gitHubAppId?:             number
  gitHubAppPrivateKey?:     string
  gitHubClientId:           string
  gitHubClientSecret:       string
}

// ── Cross-module callbacks ────────────────────────────────────────
// mcp is a logic module; it cannot import @foundry/sandbox or @foundry/crud
// directly (manifest check). The callbacks below let the composition root
// (engine layer) inject the few cross-module functions mcp needs.

export interface ExecutionCreateInput {
  command:      string
  session_id?:  string
  tool_name?:   string
  tool_input?:  unknown
  tool_use_id?: string
  timeout_ms?:  number
  env?:         Record<string, string>
}

export interface ExecHandleEmitter {
  on(event: 'stdout' | 'stderr', listener: (line: string) => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
}

export type ExecutionCreate = (
  input: ExecutionCreateInput,
) => { id: string; emitter: ExecHandleEmitter }

export type DecryptSecret = (encrypted: string) => string
