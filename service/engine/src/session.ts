// Drive one session from "minted JWT + built context" to "pipeline
// returned or threw." The pipeline below mirrors README.md exactly —
// every entry here is one box in that diagram, in order.

import type { Result } from '@foundry/model'
import { ok } from '@foundry/model'

import type { EngineError, SessionContext, SessionStep } from './schema.js'

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
  initial: SessionContext, role: 'producer' | 'verifier',
): Promise<Result<void, EngineError>> {
  await buildPipeline(role)(initial)
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
