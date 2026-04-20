// Create a fresh scratch tmpdir for this session; destroy it on exit
// regardless of success/failure. Also register the workspace path with
// the execution service so the persistent session container can
// bind-mount it at /work on first tool use.

import { workspaceEmpty, workspaceDestroy } from '../../../integrations/github/tools.js'
import { registerSessionWorkspace, unregisterSessionWorkspace } from '../../../executions/service.js'
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
