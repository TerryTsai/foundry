// Assemble the layered system prompt (founder → project → role → ticket
// → comments → prior verdicts). Verifier sessions get an extra rubric.

import type { Account, Project, Ticket, Agent } from '@foundry/db'
import type { Ctx } from '@foundry/model'
import type { EngineDeps, Middleware, Role } from '../schema.js'

async function assemble(ctx: Ctx, deps: EngineDeps, ticket: Ticket, agent: Agent, role: Role): Promise<string> {
  const parts: string[] = []
  await appendCoreSections(parts, ctx, deps, ticket, agent, role)
  await appendCommentsSection(parts, ctx, deps, ticket.id)
  await appendVerdictsSection(parts, ctx, deps, ticket.id)
  return parts.join('\n\n---\n\n')
}

async function appendCoreSections(
  parts: string[], ctx: Ctx, deps: EngineDeps, ticket: Ticket, agent: Agent, role: Role,
): Promise<void> {
  const { project, account } = await loadProjectAccount(ctx, deps, ticket.project_id)
  pushSection(parts, 'Founder', account?.description)
  pushSection(parts, 'Project', project?.description)
  pushSection(parts, 'Your role', agent.description)
  pushSection(parts, 'Ticket', ticket.description)
  if (role === 'verifier') parts.push(verifierInstructions())
}

async function loadProjectAccount(
  ctx: Ctx, deps: EngineDeps, projectId: string,
): Promise<{ project: Project | undefined; account: Account | undefined }> {
  const projectR = await deps.projectGetById(ctx, projectId)
  const project  = projectR.ok ? projectR.value : undefined
  if (!project) return { project: undefined, account: undefined }
  const accR = await deps.accountGetById(ctx, project.owner_id)
  return { project, account: accR.ok ? accR.value : undefined }
}

function verifierInstructions(): string {
  return `## Verification task

You are verifying the producer's work on the ticket above — you are NOT completing the task yourself. Review what the producer did: read their comments on this ticket, inspect any files they left in the workspace, and check the Prior verdicts section below if present.

Then call the \`verdictReport\` tool exactly once with:
- \`pass: true\` if the producer's output satisfies the ticket, or
- \`pass: false\` with a specific \`reason\` describing what is missing or wrong.

You MUST call verdictReport before ending your session. A silent verifier is treated as a failed review.`
}

function pushSection(parts: string[], heading: string, body: string | null | undefined): void {
  if (body && body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`)
}

async function appendCommentsSection(parts: string[], ctx: Ctx, deps: EngineDeps, ticketId: string): Promise<void> {
  const r = await deps.commentByTicket(ctx, ticketId)
  const comments = r.ok ? r.value : []
  if (comments.length === 0) return
  parts.push('## Comments\n\n' + comments.map(c => `[${c.author}] ${c.body}`).join('\n\n'))
}

async function appendVerdictsSection(parts: string[], ctx: Ctx, deps: EngineDeps, ticketId: string): Promise<void> {
  const r = await deps.verdictByTicket(ctx, ticketId)
  const verdicts = r.ok ? r.value : []
  if (verdicts.length === 0) return
  const lines = await Promise.all(verdicts.map(v => formatVerdict(ctx, deps, v)))
  parts.push('## Prior verdicts on this ticket\n\n' + lines.join('\n\n') + '\n\nAddress any FAIL reasons above before reporting finished again.')
}

async function formatVerdict(ctx: Ctx, deps: EngineDeps, v: { agent_id: string; pass: boolean; reason: string }): Promise<string> {
  const agentR = await deps.agentGetById(ctx, v.agent_id)
  const name = agentR.ok ? (agentR.value?.name ?? v.agent_id) : v.agent_id
  const tag  = v.pass ? 'PASS' : 'FAIL'
  return `[${name}] ${tag} — ${v.reason}`
}

export function buildSystemPrompt(role: Role): Middleware {
  return (next) => async (sessionCtx) => {
    sessionCtx.systemPrompt = await assemble(sessionCtx.ctx, sessionCtx.deps, sessionCtx.ticket, sessionCtx.agent, role)
    return next(sessionCtx)
  }
}
