// Wiring for @foundry/engine. createEngineService binds db, config, the
// CrudClient + AuthClient, the encryption key, plus the expanded sandbox
// + mcp callbacks at composition time and returns an EngineClient.
// runSession loads the agent + ticket + session rows via crud, mints
// the sandbox JWT via auth, and hands the fully-populated SessionContext
// to the pipeline.

import type { Db } from '@foundry/db'
import type { Agent, Connection, Ticket } from '@foundry/db'
import type { Ctx, Result } from '@foundry/model'
import { err } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'
import type { AuthClient } from '@foundry/auth/client'
import type { SandboxError } from '@foundry/sandbox'

import { runSession as runSessionInternal } from './session.js'
import type {
  EngineConfig, EngineError, ExecutionCreateInput, ExecutionHandle,
  IntegrationModule, McpConnCtx, McpFoundryCtx, McpGithubCtx, McpResult, McpSandboxCtx,
  ParsedConn, SessionContext, ToolSelection, ToolServer,
} from './schema.js'
import type { EngineClient, RunSessionArgs } from './client.js'

// eslint-disable-next-line max-lines-per-function -- composition root: every cross-module callback the engine pipeline consumes, expanded
export const createEngineService = (
  db: Db,
  config: EngineConfig,
  crud: CrudClient,
  auth: AuthClient,
  encryptionKey: Buffer,
  executionCreate:            (config: EngineConfig, input: ExecutionCreateInput) => Result<ExecutionHandle, SandboxError>,
  registerSessionWorkspace:   (sessionId: string, workspace: string) => void,
  unregisterSessionWorkspace: (sessionId: string) => void,
  stopSessionContainer:       (sessionId: string) => Promise<void>,
  foundryServer:              ToolServer<McpFoundryCtx>,
  githubServer:               ToolServer<McpGithubCtx>,
  sandboxServer:              ToolServer<McpSandboxCtx>,
  browserServer:              ToolServer<McpSandboxCtx>,
  byConnectionKind:           Record<string, IntegrationModule<McpConnCtx> | undefined>,
  filterTools:                <T extends { name: string }>(tools: T[], allowed: string[] | '*' | null | undefined) => T[],
  parseToolSelection:         (raw: string | null) => ToolSelection,
  parseConn:                  (conn: Connection, decrypt: (s: string) => string) => ParsedConn,
  asText:                     (value: unknown) => McpResult,
  isMcpEnvelope:              (value: unknown) => value is McpResult,
  toolUseId:                  (extra: unknown) => string | undefined,
  workspaceEmpty:             () => Promise<string>,
  workspaceDestroy:           (path: string) => Promise<void>,
): EngineClient => {
  const runtime = {
    db, config, crud, auth, encryptionKey,
    executionCreate, registerSessionWorkspace, unregisterSessionWorkspace, stopSessionContainer,
    foundryServer, githubServer, sandboxServer, browserServer,
    byConnectionKind, filterTools, parseToolSelection,
    parseConn, asText, isMcpEnvelope, toolUseId,
    workspaceEmpty, workspaceDestroy,
  }
  return {
    runSession: async (ctx, args) => {
      const loaded = await loadSessionRows(ctx, crud, args)
      if (!loaded.ok) return loaded
      const tokenR = await auth.sessionJwtMint(ctx, args.sessionId, mintTtl(config.sandboxTimeout))
      if (!tokenR.ok) return err({ kind: 'crashed', message: `failed to mint sandbox token: ${tokenR.error.kind}` })
      return runSessionInternal({ ...runtime, ctx, ...loaded.value, sandboxToken: tokenR.value, systemPrompt: '', userPrompt: '', workDir: '', shouldStop: async () => false, startedAt: Date.now() }, args.role)
    },
  }
}

async function loadSessionRows(
  ctx: Ctx, crud: CrudClient, args: RunSessionArgs,
): Promise<Result<{ session: SessionContext['session']; ticket: Ticket; agent: Agent; project: SessionContext['project'] }, EngineError>> {
  const agentR = await crud.agentGetById(ctx, args.agentId)
  if (!agentR.ok)   return err({ kind: 'crashed', message: `agentGetById: ${agentR.error.kind}` })
  if (!agentR.value) return err({ kind: 'not_found', entity: 'agent', id: args.agentId })
  const ticketR = await crud.ticketGetById(ctx, args.ticketId)
  if (!ticketR.ok)   return err({ kind: 'crashed', message: `ticketGetById: ${ticketR.error.kind}` })
  if (!ticketR.value) return err({ kind: 'not_found', entity: 'ticket', id: args.ticketId })
  const sessionR = await crud.sessionGetById(ctx, args.sessionId)
  if (!sessionR.ok)   return err({ kind: 'crashed', message: `sessionGetById: ${sessionR.error.kind}` })
  if (!sessionR.value) return err({ kind: 'not_found', entity: 'session', id: args.sessionId })
  const projectR = await crud.projectGetById(ctx, ticketR.value.project_id)
  return { ok: true, value: {
    session: sessionR.value, ticket: ticketR.value, agent: agentR.value,
    project: projectR.ok ? projectR.value : undefined,
  } }
}

function mintTtl(sandboxTimeout: number): number {
  return Math.max(sandboxTimeout * 2, 30 * 60 * 1000)
}
