// Create a fresh scratch tmpdir for this session; destroy it on exit
// regardless of success/failure. Also register the workspace path with
// the execution service so the persistent session container can
// bind-mount it at /home/foundry on first tool use.

import { workspaceEmpty, workspaceDestroy } from '@foundry/mcp'
import { registerSessionWorkspace, unregisterSessionWorkspace } from '@foundry/sandbox'
import type { Middleware } from './compose.js'

export const withWorkspace: Middleware = (next) => async (ctx) => {
  ctx.workDir = await workspaceEmpty()
  registerSessionWorkspace(ctx.session.id, ctx.workDir)
  try { return await next(ctx) }
  finally {
    unregisterSessionWorkspace(ctx.session.id)
    await workspaceDestroy(ctx.workDir)
  }
}
