// Create a fresh scratch tmpdir at /work for this session; destroy it on
// exit regardless of success/failure.

import { workspaceEmpty, workspaceDestroy } from '../tools/github.js'
import type { Middleware } from './compose.js'

export const withWorkspace: Middleware = (next) => async (ctx) => {
  ctx.workDir = await workspaceEmpty()
  try { return await next(ctx) }
  finally { await workspaceDestroy(ctx.workDir) }
}
