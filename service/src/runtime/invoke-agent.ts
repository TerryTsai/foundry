// The atomic step: pick the SDK for the agent's connection and run its
// turn loop. Writes activity/execution rows from inside the loop; returns
// metrics on ctx.result. All lifecycle, workspace, prompt, and cancel
// concerns live in middleware wrapped around this.

import * as database from '../database.js'
import type { SessionStep } from './compose.js'

export const invokeAgent: SessionStep = async (ctx) => {
  const conn = database.connectionGet(ctx.db, ctx.agent.connection_id)
  const loopCtx = {
    db:           ctx.db,
    config:       ctx.config,
    sessionId:    ctx.session.id,
    ticketData:   ctx.ticket,
    agentDef:     ctx.agent,
    systemPrompt: ctx.systemPrompt,
    userPrompt:   ctx.userPrompt,
    workDir:      ctx.workDir,
    shouldStop:   ctx.shouldStop,
  }
  ctx.result = conn?.kind === 'anthropic-subscription'
    ? await (await import('./turns-claude.js')).runTurnsViaClaude(loopCtx)
    : await (await import('./turns-ai.js'    )).runTurnsViaAi   (loopCtx)
  return ctx
}
