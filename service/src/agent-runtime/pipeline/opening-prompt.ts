// Compute the session's trigger user-prompt and record it as a 'prompt'
// activity at order_index 0.

import * as database from '../../core/db.js'
import { now } from '../../core/util.js'
import type { Ticket } from '../../core/schema.js'
import type { Middleware } from './compose.js'

function triggerPrompt(ticket: Ticket): string {
  const title = ticket.title.trim() || '(untitled)'
  return `Begin work on the ticket above: **${title}**. Proceed autonomously.`
}

export const withOpeningPrompt: Middleware = (next) => async (ctx) => {
  ctx.userPrompt = triggerPrompt(ctx.ticket)
  database.activityInsert(ctx.db, {
    session_id:   ctx.session.id,
    turn_id:      null,
    kind:         'prompt',
    order_index:  0,
    payload:      JSON.stringify({ text: ctx.userPrompt }),
    tool_use_id:  null,
    execution_id: null,
    tokens_in:    null,
    tokens:       null,
    created_at:   now(),
  })
  return next(ctx)
}
