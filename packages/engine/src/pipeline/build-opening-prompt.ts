// Compute the session's trigger user-prompt and record it as a 'prompt'
// activity at order_index 0. Attachments on the ticket are LISTED here
// (id, name, mime, size) so the agent knows they exist — bytes arrive
// only when the agent explicitly calls the attachmentGet tool, keeping
// the initial context cheap regardless of how many files are attached.

import type { Db } from '@foundry/db'
import { now } from '@foundry/model'
import type { Ticket } from '@foundry/db'
import type { EngineDeps, SessionStep } from '../types.js'

function triggerPrompt(db: Db, ticket: Ticket, deps: EngineDeps): string {
  const title = ticket.title.trim() || '(untitled)'
  const lines: string[] = [`Begin work on the ticket above: **${title}**. Proceed autonomously.`]

  const atts = deps.crud.attachmentListByTicketInternal(db, ticket.id)
  if (atts.length > 0) {
    lines.push('')
    lines.push(`This ticket has ${atts.length} attachment${atts.length === 1 ? '' : 's'}. Call \`attachmentGet\` with the id to view the content; do that only when you actually need to see it.`)
    lines.push('')
    for (const a of atts) {
      const kb = (a.size / 1024).toFixed(0)
      lines.push(`- \`${a.id}\` — ${a.name} (${a.mime}, ${kb} KB)`)
    }
  }

  return lines.join('\n')
}

export function buildOpeningPrompt(next: SessionStep): SessionStep {
  return async (ctx) => {
    ctx.userPrompt = triggerPrompt(ctx.db, ctx.ticket, ctx.deps)
    ctx.deps.crud.activityCreate(ctx.db, {
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
}
