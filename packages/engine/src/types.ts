// Module-internal types for @foundry/engine.
//
// Engine cannot import other logic modules (auth/mcp/sandbox/crud) — see
// ARCHITECTURE.md. All cross-module functions arrive via EngineDeps,
// constructed at the composition root.

import type { ZodType } from 'zod'
import type { Db } from '@foundry/db'
import type { Account, Activity, Agent, Connection, Comment, Event, Project, Session, Ticket } from '@foundry/db'
import type { Result, AuthError, SandboxError } from '@foundry/model'

// ── EngineConfig ─────────────────────────────────────────────────────
// Engine reads `sandboxTimeout` directly (mintTtl). The remaining fields
// are pass-through — the engine threads `config` into tool ctx objects
// that mcp tool handlers consume; the engine itself never inspects them.
// Composition root passes the service Config; structural typing makes it
// compatible with both this and the mcp/sandbox config slices.

export interface EngineConfig {
  sandboxTimeout:    number
  // Pass-through fields used downstream by mcp tools / sandbox exec.
  port:              number
  sandboxImage:      string
  sandboxMemoryMb:   number
  sandboxCpus:       number
  sandboxPidsLimit:  number
  sandboxNofileSoft: number
  sandboxNofileHard: number
  sandboxTmpfsMb:    number
  internalApiToken:  string
  // GitHub App credentials threaded through to mcp's github tools. The
  // engine never reads them, but they must be on the type so the same
  // config object satisfies both EngineConfig (engine reads) and the
  // EngineMcpConfig field on every Mcp*Ctx (mcp reads).
  gitHubAppId?:          number
  gitHubAppPrivateKey?:  string
  gitHubClientId:        string
  gitHubClientSecret:    string
}

// ── McpConfig mirror ────────────────────────────────────────────────
// MCP tool handlers receive `config` typed as the mcp module's McpConfig.
// Engine cannot import @foundry/mcp; the composition root passes the full
// service Config which structurally satisfies both EngineConfig and this.

export interface EngineMcpConfig {
  port:                  number
  sandboxImage:          string
  sandboxTimeout:        number
  sandboxMemoryMb:       number
  sandboxCpus:           number
  sandboxPidsLimit:      number
  sandboxNofileSoft:     number
  sandboxNofileHard:     number
  sandboxTmpfsMb:        number
  internalApiToken:      string
  gitHubAppId?:          number
  gitHubAppPrivateKey?:  string
  gitHubClientId:        string
  gitHubClientSecret:    string
}

// ── ToolDef (structural) ────────────────────────────────────────────
// Local structural mirror of @foundry/mcp's ToolDef. The engine cannot
// import @foundry/mcp; the composition root passes mcp's actual ToolDef
// objects, and TS structural typing makes them assignable here.

// Method-syntax `handler` triggers TS's bivariant parameter checking,
// matching @foundry/mcp's ToolDef so tools whose handlers are typed by
// their zod-inferred args fit through this shared slot without a cast.
export interface ToolDef<TCtx = unknown> {
  name:        string
  description: string
  schema:      ZodType
  handler(ctx: TCtx, args: unknown): Promise<unknown> | unknown
}

export interface ToolServer<TCtx = unknown> {
  tools: ToolDef<TCtx>[]
}

// Connection-bound tool module shape from mcp's byConnectionKind.
export interface IntegrationModule<TCtx = McpConnCtx> {
  tools: ToolDef<TCtx>[]
}

// Result of mcp's parseConn — typed structurally.
export interface ParsedConn {
  secrets:    Record<string, string>
  connConfig: Record<string, unknown>
}

// MCP tool selection (mirrors @foundry/mcp's McpToolSelection).
export type ToolSelection = Record<string, string[] | '*'> | null

// MCP envelope: every tool eventually returns content blocks for the model.
export interface McpResult {
  content: Array<Record<string, unknown>>
}

// ── MCP server-context mirrors ──────────────────────────────────────
// The engine builds these ctx objects per session and passes them to the
// matching mcp tool handlers. These mirrors live in engine/types.ts so the
// engine compiles without importing @foundry/mcp; @foundry/server (the
// composition root) statically asserts that each mirror is assignable to
// the corresponding mcp interface, catching drift at build time.

export interface McpFoundryCtx {
  db:               Db
  config:           EngineMcpConfig
  sessionId:        string
  workspace:        string
  projectId:        string
  accountId:        string
  ticketId:         string
  agentName:        string
  sandboxToken:     string
  toolUseId?:       string
  executionCreate:  ExecutionCreate
}

export interface McpGithubCtx {
  db:               Db
  config:           EngineMcpConfig
  sessionId:        string
  workspace:        string
  ticket:           Ticket
  agentName:        string
  toolUseId?:       string
  executionCreate:  ExecutionCreate
  projectGet:       (db: Db, projectId: string) => Project | undefined
}

// Both the sandbox and browser servers share this shape.
export interface McpSandboxCtx {
  db:               Db
  config:           EngineMcpConfig
  sessionId:        string
  workspace:        string
  toolUseId?:       string
  executionCreate:  ExecutionCreate
}

export interface McpConnCtx {
  db:               Db
  config:           EngineMcpConfig
  sessionId:        string
  workspace:        string
  secrets:          Record<string, string>
  connConfig:       Record<string, unknown>
  connectionName:   string
  toolUseId?:       string
  executionCreate:  ExecutionCreate
}

// ── Sandbox execution shape ──────────────────────────────────────────
// Local structural mirror of @foundry/sandbox's ExecutionCreateInput +
// emitter. Engine forwards these straight through to tool ctx.

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

export interface ExecutionHandle {
  id:      string
  emitter: ExecHandleEmitter
}

export type ExecutionCreate = (input: ExecutionCreateInput) => ExecutionHandle

// ── Verdict shape (structural mirror of crud's VerdictRow) ───────────

export interface VerdictRow {
  id:         string
  session_id: string
  agent_id:   string
  ticket_id:  string
  pass:       boolean
  reason:     string
  created_at: string
}

// ── Attachment summary returned by attachmentListByTicketInternal ────

export interface AttachmentSummary {
  id:   string
  name: string
  mime: string
  size: number
}

// ── EngineDeps ───────────────────────────────────────────────────────
// Single bundle of every cross-module function the engine needs. The
// composition root constructs this once per service boot from the real
// implementations in @foundry/{auth,mcp,sandbox,crud}.

export interface EngineCrudOps {
  // crypto / connection helpers
  encryptSecret:                   (s: string) => string
  decryptSecret:                   (s: string) => string
  attachmentListByTicketInternal:  (db: Db, ticketId: string) => AttachmentSummary[]
  // entity reads
  ticketGetById:                   (db: Db, id: string) => Ticket | undefined
  sessionGetById:                  (db: Db, id: string) => Session | undefined
  agentGetById:                    (db: Db, id: string) => Agent | undefined
  projectGetById:                  (db: Db, id: string) => Project | undefined
  accountGetById:                  (db: Db, id: string) => Account | undefined
  connectionGetById:               (db: Db, id: string) => Connection | undefined
  connectionByAccount:             (db: Db, accountId: string) => Connection[]
  commentByTicket:                 (db: Db, ticketId: string) => Comment[]
  verdictBySession:                (db: Db, sessionId: string) => VerdictRow | undefined
  verdictByTicket:                 (db: Db, ticketId: string) => VerdictRow[]
  // entity writes
  ticketUpdateById:                (db: Db, id: string, data: Record<string, unknown>) => Ticket
  sessionUpdateById:               (db: Db, id: string, data: Record<string, unknown>) => Session
  connectionUpdateById:            (db: Db, id: string, data: Record<string, unknown>) => Connection
  activityCreate:                  (db: Db, data: Record<string, unknown>) => Activity
  activityUpdate:                  (db: Db, id: string, data: Record<string, unknown>) => Activity
  activityByTurnOrder:             (db: Db, sessionId: string, turnId: string, orderIndex: number) => Activity | undefined
  // event log
  eventCreate:                     (db: Db, data: { entity_type: string; entity_id: string; kind: string; data?: string; caused_by: string; caused_by_id?: string | null }) => Event
}

export interface EngineDeps {
  auth: {
    sessionJwtMint: (db: Db, sessionId: string, ttlMs: number) => Result<string, AuthError>
  }
  mcp: {
    foundryServer: ToolServer<McpFoundryCtx>
    githubServer:  ToolServer<McpGithubCtx>
    sandboxServer: ToolServer<McpSandboxCtx>
    browserServer: ToolServer<McpSandboxCtx>
    byConnectionKind: Record<string, IntegrationModule<McpConnCtx> | undefined>
    filterTools:        <T extends { name: string }>(tools: T[], allowed: string[] | '*' | null | undefined) => T[]
    parseToolSelection: (raw: string | null) => ToolSelection
    parseConn:          (conn: Connection, decrypt: (s: string) => string) => ParsedConn
    asText:             (value: unknown) => McpResult
    isMcpEnvelope:      (value: unknown) => value is McpResult
    toolUseId:          (extra: unknown) => string | undefined
    workspaceEmpty:     () => Promise<string>
    workspaceDestroy:   (path: string) => Promise<void>
  }
  sandbox: {
    executionCreate:            (db: Db, config: EngineConfig, input: ExecutionCreateInput) => Result<ExecutionHandle, SandboxError>
    registerSessionWorkspace:   (sessionId: string, workspace: string) => void
    unregisterSessionWorkspace: (sessionId: string) => void
    stopSessionContainer:       (sessionId: string) => Promise<void>
  }
  crud: EngineCrudOps
}

// ── SessionContext ───────────────────────────────────────────────────
// Threaded through every middleware. The deps reference is set by
// runSession before the pipeline starts.

export interface LoopResult {
  finishReason: string | null
  tokensIn:     number
  tokensOut:    number
  toolCalls:    number
  costUsd:      number
  cancelled:    boolean
}

export interface SessionContext {
  db:           Db
  config:       EngineConfig
  deps:         EngineDeps
  session:      Session
  ticket:       Ticket
  agent:        Agent
  systemPrompt: string
  userPrompt:   string
  workDir:      string
  sandboxToken: string   // per-session bearer; minted in runSession
  shouldStop:   () => boolean
  result?:      LoopResult
  startedAt:    number
}

// Re-export Connection so engines can type their locals without
// reaching across module boundaries themselves.
export type { Connection }
