// Drive one session from "minted JWT + built context" to "pipeline
// returned or threw." The pipeline below mirrors README.md exactly —
// every entry here is one box in that diagram, in order.

import { type Db } from '@foundry/db'
import type { Agent, Ticket } from '@foundry/db'
import type { Ctx, Result } from '@foundry/model'
import { ok, err } from '@foundry/model'

import type { EngineConfig, EngineDeps, EngineError, SessionContext, SessionStep } from './schema.js'

import { compose }              from './pipeline/compose.js'
import { catchCrash }            from './pipeline/catch-crash.js'
import { recordSession }         from './pipeline/record-session.js'
import { failTicketOnCrash }     from './pipeline/fail-ticket-on-crash.js'
import { failVerdictOnSilence }  from './pipeline/fail-verdict-on-silence.js'
import { provisionWorkspace }    from './pipeline/provision-workspace.js'
import { buildSystemPrompt }     from './pipeline/build-system-prompt.js'
import { buildOpeningPrompt }    from './pipeline/build-opening-prompt.js'
import { pollCancel }            from './pipeline/poll-cancel.js'
import { runEngine }             from './pipeline/run-engine.js'

export async function runSession(
  ctx: Ctx, db: Db, config: EngineConfig, deps: EngineDeps, sessionId: string,
  agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<Result<void, EngineError>> {
  const sessionR = await deps.sessionGetById(ctx, sessionId)
  if (!sessionR.ok) return err({ kind: 'crashed', message: `sessionGetById: ${sessionR.error.message}` })
  const session = sessionR.value
  if (!session) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const projectR = await deps.projectGetById(ctx, ticket.project_id)
  if (!projectR.ok) return err({ kind: 'crashed', message: `projectGetById: ${projectR.error.message}` })
  const tokenResult = mintSandboxToken(db, deps, sessionId, config.sandboxTimeout)
  if (!tokenResult.ok) return tokenResult
  const sessionCtx = buildSessionContext(ctx, db, config, deps, session, ticket, agent, projectR.value, tokenResult.value)
  await buildPipeline(role)(sessionCtx)
  return ok(undefined)
}

// Pipeline composed fresh per session. The producer and verifier
// chains differ in exactly one slot — the role-specific failure
// middleware. Composing inline (rather than at module scope) keeps
// session.ts free of module-level state.
function buildPipeline(role: 'producer' | 'verifier'): SessionStep {
  const failure = role === 'verifier' ? failVerdictOnSilence : failTicketOnCrash
  return compose(
    catchCrash,
    recordSession,
    failure,
    provisionWorkspace,
    buildSystemPrompt(role),
    buildOpeningPrompt,
    pollCancel,
    runEngine,
  )(async (ctx) => ctx)
}

function mintSandboxToken(
  db: Db, deps: EngineDeps, sessionId: string, sandboxTimeout: number,
): Result<string, EngineError> {
  const ttlMs = Math.max(sandboxTimeout * 2, 30 * 60 * 1000)
  const r = deps.sessionJwtMint(db, sessionId, ttlMs)
  if (!r.ok) return err({ kind: 'crashed', message: `failed to mint sandbox token: ${r.error.kind}` })
  return ok(r.value)
}

function buildSessionContext(
  ctx: Ctx, db: Db, config: EngineConfig, deps: EngineDeps,
  session: SessionContext['session'], ticket: Ticket, agent: Agent,
  project: SessionContext['project'], sandboxToken: string,
): SessionContext {
  return {
    ctx, db, config, deps, session, ticket, agent, project, sandboxToken,
    systemPrompt: '', userPrompt: '', workDir: '',
    shouldStop: async () => false,
    startedAt: Date.now(),
  }
}
