// Drive one session from "minted JWT + built context" to "pipeline
// returned or threw." The pipeline below mirrors README.md exactly —
// every entry here is one box in that diagram, in order.

import { type Db } from '@foundry/db'
import type { Agent, Ticket } from '@foundry/db'
import type { Result } from '@foundry/model'
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
  db: Db, config: EngineConfig, deps: EngineDeps, sessionId: string,
  agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<Result<void, EngineError>> {
  const session = deps.crud.sessionGetById(db, sessionId)
  if (!session) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const tokenResult = mintSandboxToken(db, deps, sessionId, config.sandboxTimeout)
  if (!tokenResult.ok) return tokenResult
  const ctx = buildSessionContext(db, config, deps, session, ticket, agent, tokenResult.value)
  await buildPipeline(role)(ctx)
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
  const r = deps.auth.sessionJwtMint(db, sessionId, ttlMs)
  if (!r.ok) return err({ kind: 'crashed', message: `failed to mint sandbox token: ${r.error.kind}` })
  return ok(r.value)
}

function buildSessionContext(
  db: Db, config: EngineConfig, deps: EngineDeps,
  session: SessionContext['session'], ticket: Ticket, agent: Agent, sandboxToken: string,
): SessionContext {
  return {
    db, config, deps, session, ticket, agent, sandboxToken,
    systemPrompt: '', userPrompt: '', workDir: '',
    shouldStop: () => false,
    startedAt: Date.now(),
  }
}
