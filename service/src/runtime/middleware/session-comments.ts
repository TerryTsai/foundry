// Post "Session started" before the loop and a status comment after.
// Replaces the ad-hoc sessionStartedComment calls that lived in the
// domain callers (sessions.ts, scheduler.ts) and the orchestrator.

import * as database from '../../database.js'
import { now } from '../../util.js'
import type { Middleware } from '../compose.js'

function postComment(db: import('../../database.js').Db, ctx: { ticket: { id: string }; session: { id: string }; agent: { name: string } }, body: string) {
  database.commentInsert(db, {
    ticket_id:  ctx.ticket.id,
    session_id: ctx.session.id,
    author:     ctx.agent.name,
    body,
    created_at: now(),
  })
}

export const withSessionComments: Middleware = (next) => async (ctx) => {
  postComment(ctx.db, ctx, 'Session started')
  await next(ctx)
  const r = ctx.result
  if (!r)           postComment(ctx.db, ctx, 'Session crashed')
  else if (r.cancelled) postComment(ctx.db, ctx, 'Session cancelled')
  else              postComment(ctx.db, ctx, 'Session finished')
  return ctx
}
