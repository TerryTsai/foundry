// Module-internal types for @foundry/engine.
//
// Engine cannot import other logic modules (auth/mcp/sandbox/crud) — see
// ARCHITECTURE.md. All cross-module functions arrive via EngineDeps,
// constructed at the composition root.

import type { ZodType } from 'zod'
import type { Db } from '@foundry/db'
import type { Agent, Connection, Ticket, Session } from '@foundry/db'

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
}

// ── ToolDef (structural) ────────────────────────────────────────────
// Local structural mirror of @foundry/mcp's ToolDef. The engine cannot
// import @foundry/mcp; the composition root passes mcp's actual ToolDef
// objects, and TS structural typing makes them assignable here.

export interface ToolDef {
  name:        string
  description: string
  schema:      ZodType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mirror
  handler:     (ctx: any, args: any) => any
}

export interface ToolServer {
  tools: ToolDef[]
}

// Connection-bound tool module shape from mcp's byConnectionKind.
export interface IntegrationModule {
  tools: ToolDef[]
}

// Result of mcp's parseConn — typed structurally.
export interface ParsedConn {
  secrets:    Record<string, unknown>
  connConfig: Record<string, unknown>
}

// MCP tool selection (mirrors @foundry/mcp's McpToolSelection).
export type ToolSelection = Record<string, string[] | '*'> | null

// MCP envelope-aware response (text or rich content).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mcp envelope is open-shaped
export type McpResult = any

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

// ── EngineDeps ───────────────────────────────────────────────────────
// Single bundle of every cross-module function the engine needs. The
// composition root constructs this once per service boot from the real
// implementations in @foundry/{auth,mcp,sandbox,crud}.

export interface EngineDeps {
  auth: {
    sessionJwtMint: (db: Db, sessionId: string, ttlMs?: number) => string
  }
  mcp: {
    foundryServer: ToolServer
    githubServer:  ToolServer
    sandboxServer: ToolServer
    browserServer: ToolServer
    byConnectionKind: Record<string, IntegrationModule | undefined>
    filterTools:        <T extends { name: string }>(tools: T[], allowed: string[] | '*' | null | undefined) => T[]
    parseToolSelection: (raw: string | null) => ToolSelection
    parseConn:          (conn: Connection, decrypt: (s: string) => string) => ParsedConn
    asText:             (value: unknown) => McpResult
    isMcpEnvelope:      (value: unknown) => boolean
    toolUseId:          (extra: unknown) => string | undefined
    workspaceEmpty:     () => Promise<string>
    workspaceDestroy:   (path: string) => Promise<void>
  }
  sandbox: {
    executionCreate:            (db: Db, config: EngineConfig, input: ExecutionCreateInput) => ExecutionHandle
    registerSessionWorkspace:   (sessionId: string, workspace: string) => void
    unregisterSessionWorkspace: (sessionId: string) => void
    stopSessionContainer:       (sessionId: string) => Promise<void>
  }
  crud: {
    encryptSecret:                  (s: string) => string
    decryptSecret:                  (s: string) => string
    attachmentListByTicketInternal: (db: Db, ticketId: string) => Array<{
      id:   string
      name: string
      mime: string
      size: number
    }>
  }
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
