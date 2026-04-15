// Assemble the layered system prompt (founder → project → role → ticket
// → comments → prior verdicts) and persist it on the session row so
// historical sessions remain reproducible after the source layers change.
//
// Note: prior verdicts are fetched live from the DB. Within a single
// verifier dance, verifier N+1 therefore sees verifier N's verdict in
// its own system prompt — same behavior as before the refactor.

import * as database from '../../database.js'
import type { Ticket, Agent as AgentDef } from '../../tables.js'
import type { Db } from '../../database.js'
import type { Middleware } from '../compose.js'

function assemble(db: Db, ticket: Ticket, agent: AgentDef): string {
  const project = database.projectGet(db, ticket.project_id)
  const account = project ? database.accountGet(db, project.owner_id) : undefined

  const parts: string[] = []
  const push = (heading: string, body: string | null | undefined) => {
    if (body && body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`)
  }
  push('Founder',   account?.description)
  push('Project',   project?.description)
  push('Your role', agent.description)
  push('Ticket',    ticket.description)

  const comments = database.commentByTicket(db, ticket.id)
  if (comments.length > 0) {
    parts.push('## Comments\n\n' + comments.map(c => `[${c.author}] ${c.body}`).join('\n\n'))
  }

  const verdicts = database.verdictByTicket(db, ticket.id)
  if (verdicts.length > 0) {
    const lines = verdicts.map(v => {
      const name = database.agentGet(db, v.agent_id)?.name ?? v.agent_id
      const tag  = v.pass ? 'PASS' : 'FAIL'
      return `[${name}] ${tag} — ${v.reason}`
    })
    parts.push('## Prior verdicts on this ticket\n\n' + lines.join('\n\n') + '\n\nAddress any FAIL reasons above before reporting finished again.')
  }
  return parts.join('\n\n---\n\n')
}

export const withSystemPrompt: Middleware = (next) => async (ctx) => {
  ctx.systemPrompt = assemble(ctx.db, ctx.ticket, ctx.agent)
  if (ctx.systemPrompt) {
    database.sessionUpdate(ctx.db, ctx.session.id, { system_prompt: ctx.systemPrompt })
  }
  return next(ctx)
}
