// Create a fresh scratch tmpdir for this session; destroy it on exit
// regardless of success/failure. Also register the workspace path with
// the execution service so the persistent session container can
// bind-mount it at /home/foundry on first tool use.

import type { SessionStep } from '../schema.js'

export function provisionWorkspace(next: SessionStep): SessionStep {
  return async (ctx) => {
    ctx.workDir = await ctx.deps.mcp.workspaceEmpty()
    ctx.deps.sandbox.registerSessionWorkspace(ctx.session.id, ctx.workDir)
    try { return await next(ctx) }
    finally {
      ctx.deps.sandbox.unregisterSessionWorkspace(ctx.session.id)
      await ctx.deps.mcp.workspaceDestroy(ctx.workDir)
    }
  }
}
