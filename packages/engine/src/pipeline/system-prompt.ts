// Assemble the layered system prompt (founder → project → role → ticket
// → comments → prior verdicts). The prompt also lands as the first
// activity row of the session (kind='prompt') via withOpeningPrompt
// later in the pipeline, so the session is reproducible from its
// activity stream alone.
//
// Factory takes the session role. Verifier sessions get an extra section
// telling the agent it is reviewing the producer's work, not doing the
// task, and must call verdictReport before ending. Without this, a
// verifier reads the Ticket section and treats it as its own task.
//
// Note: prior verdicts are fetched live from the DB (verdict rows are
// activity rows of kind='verdict'). Within a single verifier dance,
// verifier N+1 therefore sees verifier N's verdict in its own system
// prompt.

import * as database from '@foundry/db'
import type { Db, Ticket, Agent } from '@foundry/db'
import type { Middleware } from './compose.js'

type Role = 'producer' | 'verifier'

const VERIFIER_RUBRIC = `## Verification task

You are verifying the producer's work on the ticket above — you are NOT completing the task yourself. Review what the producer did: read their comments on this ticket, inspect any files they left in the workspace, and check the Prior verdicts section below if present.

Then call the \`verdictReport\` tool exactly once with:
- \`pass: true\` if the producer's output satisfies the ticket, or
- \`pass: false\` with a specific \`reason\` describing what is missing or wrong.

You MUST call verdictReport before ending your session. A silent verifier is treated as a failed review.`

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
function assemble(db: Db, ticket: Ticket, agent: Agent, role: Role): string {
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
  if (role === 'verifier') parts.push(VERIFIER_RUBRIC)

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

export const withSystemPrompt = (role: Role): Middleware => (next) => async (ctx) => {
  ctx.systemPrompt = assemble(ctx.db, ctx.ticket, ctx.agent, role)
  return next(ctx)
}
