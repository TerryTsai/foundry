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

// ── Connection ctx + run helpers ────────────────────────────────────
// Shared shape for connection-backed MCP servers (cloudflare, resend,
// aws, …). Built-in servers (foundry/github/sandbox/browser) use richer
// ctx types declared in their own tools.ts files.

import type { Db, Connection } from '@foundry/db'
import { z } from 'zod'

export interface ConnCtx {
  db:               Db
  config:           McpConfig
  sessionId:        string
  workspace:        string
  secrets:          Record<string, string>
  connConfig:       Record<string, unknown>
  connectionName:   string
  toolUseId?:       string
  executionCreate:  ExecutionCreate
}

// Output bounding — large tool stdout/stderr gets spilled to a workspace
// file so the agent can paginate it via the read tool. Threshold sits
// here so multiple integration handlers can reference it.
export const BOUNDED_THRESHOLD = 10_240 // 10 KB

export const boundedOutput = z.object({
  content:    z.string(),
  outputFile: z.string().optional(),
  totalLines: z.number().optional(),
  totalBytes: z.number().optional(),
  error:      z.string().optional(),
})
export type BoundedOutput = z.infer<typeof boundedOutput>

export interface RunCommandOptions {
  env?:       Record<string, string>  // extra env vars for the exec; NOT logged to DB
  timeoutMs?: number                   // override config.sandboxTimeout
  /** tool_use block id from the SDK handler's `extra._meta`. Persisted
   *  on the execution row so the UI can correlate the sandbox-domain
   *  execution back to the agent-domain tool_use block that caused it. */
  toolUseId?: string
}

// Minimal ctx slice runCommand needs. Every tool ctx (Foundry / Sandbox /
// Browser / Github / Conn) satisfies it.
export interface RunCommandCtx {
  sessionId:       string
  workspace:       string
  executionCreate: ExecutionCreate
}

// Re-export Connection so feature files don't reach into @foundry/db.
export type { Connection }

// ── agent-mcp-list result types ─────────────────────────────────────

export interface McpListEntry {
  id:          string
  name:        string
  category:    string
  description: string
  tools:       Array<{ name: string; description: string }>
}

// mcp can't import @foundry/crud — composition root injects this lookup.
export type ConnectionByAccountFn = (db: Db, accountId: string) => Connection[]

// ── Error union ─────────────────────────────────────────────────────

export type McpError =
  | { kind: 'server_unavailable'; server: string; reason: string }
  | { kind: 'tool_not_found';     server: string; tool: string }
  | { kind: 'tool_failed';        server: string; tool: string; message: string }
  | { kind: 'invalid_args';       reason: string }
  | { kind: 'internal';           message: string }
