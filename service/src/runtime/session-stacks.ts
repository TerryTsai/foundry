// Two middleware stacks, one per role. The ordering matters: outermost
// (first listed) sees the whole call including throws from inner layers;
// innermost (last listed) runs closest to the agent loop.
//
//   lifecycle         — outermost: always writes final session status
//   activity-backfill — runs in finally so mid-session throws still backfill
//   role guard        — producer fails the ticket / verifier writes synthetic
//   workspace         — setup/teardown the scratch dir
//   prompts           — assemble system + opening prompt (one-shot setup)
//   cancel            — install shouldStop() closest to the loop
//   invokeAgent       — atomic SDK dispatch

import { use } from './compose.js'
import { invokeAgent } from './invoke-agent.js'

import { withSessionLifecycle }    from './middleware/session-lifecycle.js'
import { withActivityBackfill }    from './middleware/activity-backfill.js'
import { withTicketFailOnCrash }   from './middleware/ticket-fail-on-crash.js'
import { withSyntheticFailVerdict } from './middleware/synthetic-fail-verdict.js'
import { withScratchWorkspace }    from './middleware/scratch-workspace.js'
import { withSystemPrompt }        from './middleware/system-prompt.js'
import { withOpeningPrompt }       from './middleware/opening-prompt.js'
import { withCooperativeCancel }   from './middleware/cooperative-cancel.js'

export const producerSession = use(
  withSessionLifecycle,
  withActivityBackfill,
  withTicketFailOnCrash,
  withScratchWorkspace,
  withSystemPrompt,
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)

export const verifierSession = use(
  withSessionLifecycle,
  withActivityBackfill,
  withSyntheticFailVerdict,
  withScratchWorkspace,
  withSystemPrompt,
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)
