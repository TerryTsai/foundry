// Drive one session from "minted JWT + built context" to "pipeline
// returned or threw." The pipeline below mirrors README.md exactly —
// every entry here is one box in that diagram, in order.

import { type Db } from '@foundry/db'
import type { Agent, Ticket } from '@foundry/db'
import type { Result, EngineError } from '@foundry/model'
import { ok, err } from '@foundry/model'

import type { EngineConfig, EngineDeps, SessionContext } from './types.js'

import { compose }                   from './pipeline/compose.js'
import { withBookkeeping }          from './pipeline/bookkeeping.js'
import { withCooperativeCancel }    from './pipeline/cooperative-cancel.js'
import { withCrashSafe }            from './pipeline/crash-safe.js'
import { withEngine }               from './pipeline/engine.js'
import { withOpeningPrompt }        from './pipeline/opening-prompt.js'
import { withSyntheticFailVerdict } from './pipeline/synthetic-fail-verdict.js'
import { withSystemPrompt }         from './pipeline/system-prompt.js'
import { withTicketFailOnCrash }    from './pipeline/ticket-fail-on-crash.js'
import { withWorkspace }            from './pipeline/workspace.js'

const PRODUCER = compose(
  withCrashSafe,
  withBookkeeping,
  withTicketFailOnCrash,
  withWorkspace,
  withSystemPrompt('producer'),
  withOpeningPrompt,
  withCooperativeCancel,
  withEngine,
)(async (ctx) => ctx)

const VERIFIER = compose(
  withCrashSafe,
  withBookkeeping,
  withSyntheticFailVerdict,
  withWorkspace,
  withSystemPrompt('verifier'),
  withOpeningPrompt,
  withCooperativeCancel,
  withEngine,
)(async (ctx) => ctx)

export async function runSession(
  db: Db, config: EngineConfig, deps: EngineDeps, sessionId: string,
  agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<Result<void, EngineError>> {
  const session = deps.crud.sessionGetById(db, sessionId)
  if (!session) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const tokenResult = mintSandboxToken(db, deps, sessionId, config.sandboxTimeout)
  if (!tokenResult.ok) return tokenResult
  const ctx = buildSessionContext(db, config, deps, session, ticket, agent, tokenResult.value)
  const pipeline = role === 'verifier' ? VERIFIER : PRODUCER
  await pipeline(ctx)
  return ok(undefined)
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
