// Drive one session from "minted JWT + built context" to "loop returned
// or threw." The pipeline below mirrors README.md exactly — every entry
// here is one box in that diagram, in order.

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import type { Config } from '../core/config.js'
import type { Agent, Ticket } from '../core/schema.js'

import { compose, type SessionContext, type SessionStep } from './pipeline/compose.js'
import * as sessionJwt from '../auth/session-jwt.js'

import { withActivityBackfill }     from './pipeline/activity-backfill.js'
import { withBookkeeping }          from './pipeline/bookkeeping.js'
import { withCooperativeCancel }    from './pipeline/cooperative-cancel.js'
import { withCrashSafe }            from './pipeline/crash-safe.js'
import { withOpeningPrompt }        from './pipeline/opening-prompt.js'
import { withSyntheticFailVerdict } from './pipeline/synthetic-fail-verdict.js'
import { withSystemPrompt }         from './pipeline/system-prompt.js'
import { withTicketFailOnCrash }    from './pipeline/ticket-fail-on-crash.js'
import { withWorkspace }            from './pipeline/workspace.js'

// ── pipelines ─────────────────────────────────────────────────────────
// Wrap order: outermost first. Outer middleware sees crashes and side
// effects of everything below it. The base step (invokeEngine) is what
// finally talks to the LLM. To change what wraps a session, edit the
// list — that's the whole interface.

const PRODUCER = compose(
  withCrashSafe,             // catches anything below; logs, rethrows
  withBookkeeping,           // session row started_at/ended_at/status
  withActivityBackfill,      // patches missing activity rows from execution rows
  withTicketFailOnCrash,     // ticket → failed if loop crashes
  withWorkspace,             // /tmp work dir, cloned from the project's repo
  withSystemPrompt('producer'),
  withOpeningPrompt,         // prepends the ticket's prompt
  withCooperativeCancel,     // poll session.status; signal loop to stop
)

const VERIFIER = compose(
  withCrashSafe,
  withBookkeeping,
  withActivityBackfill,
  withSyntheticFailVerdict,  // crash → synthetic 'fail' verdict
  withWorkspace,
  withSystemPrompt('verifier'),
  withOpeningPrompt,
  withCooperativeCancel,
)

// ── base step: pick an engine and call it ─────────────────────────────
// Anthropic-subscription connections use the Claude Agent SDK directly
// (claude.ai accounts via desktop credentials). Everything else goes
// through the Vercel AI SDK.

const invokeEngine: SessionStep = async (ctx) => {
  const conn = database.connectionGet(ctx.db, ctx.agent.connection_id)
  const engine = conn?.kind === 'anthropic-subscription'
    ? (await import('./engines/anthropic.js')).runEngine
    : (await import('./engines/vercel.js'   )).runEngine
  ctx.result = await engine(ctx)
  return ctx
}

// ── entrypoint ────────────────────────────────────────────────────────

export async function runSession(
  db: Db, config: Config, sessionId: string,
  agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<void> {
  const ctx = buildContext(db, config, sessionId, agent, ticket)
  const stack = role === 'verifier' ? VERIFIER : PRODUCER
  await stack(invokeEngine)(ctx)
}

function buildContext(
  db: Db, config: Config, sessionId: string, agent: Agent, ticket: Ticket,
): SessionContext {
  const session = database.sessionGet(db, sessionId)
  if (!session) throw new Error(`session ${sessionId} not found`)
  const sandboxToken = sessionJwt.mint(db, sessionId, sandboxTokenTtl(config))
  return {
    db, config, session, ticket, agent, sandboxToken,
    systemPrompt: '', userPrompt: '', workDir: '',
    shouldStop: () => false,
    startedAt: Date.now(),
  }
}

function sandboxTokenTtl(config: Config): number {
  return Math.max(config.sandboxTimeout * 2, 30 * 60 * 1000)
}
