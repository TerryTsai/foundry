// Drive one session from "minted JWT + built context" to "pipeline
// returned or threw." The pipeline below mirrors README.md exactly —
// every entry here is one box in that diagram, in order.

import { type Db } from '../../core/db.js'
import * as database from '../../core/db.js'
import type { Config } from '../../core/config.js'
import type { Agent, Ticket } from '../../core/schema.js'

import * as sessionJwt from '../../auth/session-jwt.js'

import { compose, type SessionContext } from './pipeline/compose.js'
import { withBookkeeping }          from './pipeline/bookkeeping.js'
import { withCooperativeCancel }    from './pipeline/cooperative-cancel.js'
import { withCrashSafe }            from './pipeline/crash-safe.js'
import { withEngine }               from './pipeline/engine.js'
import { withOpeningPrompt }        from './pipeline/opening-prompt.js'
import { withSyntheticFailVerdict } from './pipeline/synthetic-fail-verdict.js'
import { withSystemPrompt }         from './pipeline/system-prompt.js'
import { withTicketFailOnCrash }    from './pipeline/ticket-fail-on-crash.js'
import { withWorkspace }            from './pipeline/workspace.js'

// ── pipelines ────────────────────────────────────────────────────────
// Wrap order: outermost first. Outer middleware sees crashes and side
// effects of everything below it. The innermost stage (withEngine) is
// what finally talks to the LLM. To change what wraps a session, edit
// the list — that's the whole interface.

const PRODUCER = compose(
  withCrashSafe,             // catches anything below; logs, rethrows
  withBookkeeping,           // session row started_at/ended_at/status
  withTicketFailOnCrash,     // ticket → failed if loop crashes
  withWorkspace,             // /tmp work dir, cloned from the project's repo
  withSystemPrompt('producer'),
  withOpeningPrompt,         // prepends the ticket's prompt
  withCooperativeCancel,     // poll session.status; signal loop to stop
  withEngine,                // pick anthropic|vercel SDK and run it
)(async (ctx) => ctx)

const VERIFIER = compose(
  withCrashSafe,
  withBookkeeping,
  withSyntheticFailVerdict,  // crash → synthetic 'fail' verdict
  withWorkspace,
  withSystemPrompt('verifier'),
  withOpeningPrompt,
  withCooperativeCancel,
  withEngine,
)(async (ctx) => ctx)

// ── entrypoint ───────────────────────────────────────────────────────

export async function runSession(
  db: Db, config: Config, sessionId: string,
  agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<void> {
  // load session
  const session = database.sessionGet(db, sessionId)
  if (!session) throw new Error(`session ${sessionId} not found`)

  // mint per-session sandbox JWT — sandbox tools curl the host with
  // this; auth/middleware verifies and reads session/ticket/project/
  // account from the claims
  const ttlMs = Math.max(config.sandboxTimeout * 2, 30 * 60 * 1000)
  const sandboxToken = sessionJwt.mint(db, sessionId, ttlMs)

  // build the per-session context that flows through every middleware
  const ctx: SessionContext = {
    db, config, session, ticket, agent, sandboxToken,
    systemPrompt: '', userPrompt: '', workDir: '',
    shouldStop: () => false,
    startedAt: Date.now(),
  }

  // drive the chosen pipeline; all the work happens inside its stages
  const pipeline = role === 'verifier' ? VERIFIER : PRODUCER
  await pipeline(ctx)
}
