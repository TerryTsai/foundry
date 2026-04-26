import type { SessionStep } from '../schema.js'

// Innermost pipeline stage — picks the engine for this session's
// connection kind and runs it. anthropic-subscription connections use
// the Claude Agent SDK directly (claude.ai accounts via desktop
// credentials); everything else goes through the Vercel AI SDK.
//
// Sets ctx.result. Calls next(ctx) so any downstream stage (currently
// none — this is the leaf) sees the populated result.

export function runEngine(next: SessionStep): SessionStep {
  return async (ctx) => {
    const r = await ctx.deps.connectionGetById(ctx.ctx, ctx.agent.connection_id)
    const conn = r.ok ? r.value : undefined
    const engine = conn?.kind === 'anthropic-subscription'
      ? (await import('../engines/anthropic.js')).runEngine
      : (await import('../engines/vercel.js'   )).runEngine
    ctx.result = await engine(ctx)
    return next(ctx)
  }
}
