// Assemble the layered system prompt (founder → project → role → ticket
// → comments → prior verdicts). Verifier sessions get an extra rubric.

import type { Db, Ticket, Agent } from '@foundry/db'
import type { EngineDeps, Middleware, Role } from '../schema.js'

function assemble(db: Db, deps: EngineDeps, ticket: Ticket, agent: Agent, role: Role): string {
  const parts: string[] = []
  appendCoreSections(parts, db, deps, ticket, agent, role)
  appendCommentsSection(parts, db, deps, ticket.id)
  appendVerdictsSection(parts, db, deps, ticket.id)
  return parts.join('\n\n---\n\n')
}

function appendCoreSections(
  parts: string[], db: Db, deps: EngineDeps, ticket: Ticket, agent: Agent, role: Role,
): void {
  const project = deps.crud.projectGetById(db, ticket.project_id)
  const account = project ? deps.crud.accountGetById(db, project.owner_id) : undefined
  pushSection(parts, 'Founder', account?.description)
  pushSection(parts, 'Project', project?.description)
  pushSection(parts, 'Your role', agent.description)
  pushSection(parts, 'Ticket', ticket.description)
  if (role === 'verifier') parts.push(`## Verification task

You are verifying the producer's work on the ticket above — you are NOT completing the task yourself. Review what the producer did: read their comments on this ticket, inspect any files they left in the workspace, and check the Prior verdicts section below if present.

Then call the \`verdictReport\` tool exactly once with:
- \`pass: true\` if the producer's output satisfies the ticket, or
- \`pass: false\` with a specific \`reason\` describing what is missing or wrong.

You MUST call verdictReport before ending your session. A silent verifier is treated as a failed review.`)
}

function pushSection(parts: string[], heading: string, body: string | null | undefined): void {
  if (body && body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`)
}

function appendCommentsSection(parts: string[], db: Db, deps: EngineDeps, ticketId: string): void {
  const comments = deps.crud.commentByTicket(db, ticketId)
  if (comments.length === 0) return
  parts.push('## Comments\n\n' + comments.map(c => `[${c.author}] ${c.body}`).join('\n\n'))
}

function appendVerdictsSection(parts: string[], db: Db, deps: EngineDeps, ticketId: string): void {
  const verdicts = deps.crud.verdictByTicket(db, ticketId)
  if (verdicts.length === 0) return
  const lines = verdicts.map(v => formatVerdict(db, deps, v))
  parts.push('## Prior verdicts on this ticket\n\n' + lines.join('\n\n') + '\n\nAddress any FAIL reasons above before reporting finished again.')
}

function formatVerdict(db: Db, deps: EngineDeps, v: { agent_id: string; pass: boolean; reason: string }): string {
  const name = deps.crud.agentGetById(db, v.agent_id)?.name ?? v.agent_id
  const tag  = v.pass ? 'PASS' : 'FAIL'
  return `[${name}] ${tag} — ${v.reason}`
}

export function buildSystemPrompt(role: Role): Middleware {
  return (next) => async (ctx) => {
    ctx.systemPrompt = assemble(ctx.db, ctx.deps, ctx.ticket, ctx.agent, role)
    return next(ctx)
  }
}
