// Session runner. Runs exactly one session through the middleware stack.
// No chaining, no settle logic — the reconciler handles what happens next.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket, Session } from '../tables.js'

import { use, type SessionContext, type SessionStep } from './compose.js'
import * as sandboxToken from '../domain/sandboxToken.js'

import { withCrashSafe }            from './middleware/crash-safe.js'
import { withSessionBookkeeping }   from './middleware/session-bookkeeping.js'
import { withActivityBackfill }     from './middleware/activity-backfill.js'
import { withTicketFailOnCrash }    from './middleware/ticket-fail-on-crash.js'
import { withSyntheticFailVerdict } from './middleware/synthetic-fail-verdict.js'
import { withScratchWorkspace }     from './middleware/scratch-workspace.js'
import { withSystemPrompt }         from './middleware/system-prompt.js'
import { withOpeningPrompt }        from './middleware/opening-prompt.js'
import { withCooperativeCancel }    from './middleware/cooperative-cancel.js'

// ── atomic step: dispatch to the right SDK loop ───────────────────────────

const invokeAgent: SessionStep = async (ctx) => {
  const conn = database.connectionGet(ctx.db, ctx.agent.connection_id)
  const loop = conn?.kind === 'anthropic-subscription'
    ? (await import('./loop/anthropic.js')).runAnthropicLoop
    : (await import('./loop/vercel.js'   )).runVercelLoop
  ctx.result = await loop(ctx)
  return ctx
}

// ── stacks ────────────────────────────────────────────────────────────────

const runProducer = use(
  withCrashSafe,
  withSessionBookkeeping,
  withActivityBackfill,
  withTicketFailOnCrash,
  withScratchWorkspace,
  withSystemPrompt('producer'),
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)

const runVerifier = use(
  withCrashSafe,
  withSessionBookkeeping,
  withActivityBackfill,
  withSyntheticFailVerdict,
  withScratchWorkspace,
  withSystemPrompt('verifier'),
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)

// ── entry point ───────────────────────────────────────────────────────────

export async function runSession(
  db: Db, config: Config, sessionId: string,
  agent: AgentDef, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<void> {
  const sessionRow = database.sessionGet(db, sessionId)
  if (!sessionRow) throw new Error(`session ${sessionId} not found`)

  // Mint a per-session bearer token. Sandbox tools curl the host with this;
  // requireAuth resolves it back to (session → ticket → project → owner).
  // TTL covers the longest reasonable session run; revoked on completion.
  const sandboxTok = sandboxToken.mint(db, sessionId,
    Math.max(config.sandboxTimeout * 2, 30 * 60 * 1000))

  const ctx: SessionContext = {
    db, config, session: sessionRow, ticket, agent,
    systemPrompt: '', userPrompt: '', workDir: '',
    sandboxToken: sandboxTok,
    shouldStop: () => false,
    startedAt: Date.now(),
  }

  try {
    const stack = role === 'verifier' ? runVerifier : runProducer
    await stack(ctx)
  } finally {
    sandboxToken.revoke(db, sessionId)
  }
}
