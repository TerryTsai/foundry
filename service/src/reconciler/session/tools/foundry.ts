// Foundry harness introspection server. Every tool call runs in the
// sandbox via runCommand, curling back into the service's HTTP API with
// a per-session sandbox JWT (see ../../auth/session-jwt.ts). This gives
// each call the same execution-row treatment as sandbox/github/browser
// tools: full cgroup stats (memory, CPU, network), resource offloading
// to the container, and consistent observability in the activity
// timeline.
//
// The token is passed via the podman exec env ($TOKEN) — never printed
// in argv. Each call references it inline:
//   curl -H "Authorization: Bearer $TOKEN" …
// The agent sees the tool by name and arguments; the curl is an
// implementation detail.

import { z } from 'zod'

import type { Db } from '../../../core/db.js'
import type { Config } from '../../../core/config.js'
import { esc, runCommand } from '../../../integrations/shared.js'

import type { } from './registry.js'
import type { McpServerInfo, ToolDef } from '../../../integrations/types.js'

export interface FoundryCtx {
  db:         Db
  config:     Config
  sessionId:  string
  workspace:  string   // session tmpdir — mounted into the sandbox
  projectId:  string
  accountId:  string   // owner of the project — used for agent/connection lookups
  ticketId:   string   // parent ticket — used as parent_id when agent creates sub-tickets
  agentName:  string   // used as author of comments and created_by for new tickets
  sandboxToken: string // per-session bearer token; resolves to this session's account on the host side
  toolUseId?: string   // per-call: BetaMessage tool_use block id. Set by the sdkTool wrapper from extra._meta["claudecode/toolUseId"]; passed to runCommand so every resulting execution row carries its correlation back to the agent-domain message.
}

// ── Schemas ──

const ticketListArgs = z.object({
  status:   z.enum(['created', 'waiting', 'running', 'finished', 'failed', 'cancelled']).optional().describe('Filter by ticket state.'),
  agent_id: z.string().optional().describe('Filter by assigned agent id.'),
  tag:      z.string().optional().describe('Filter by tag.'),
})

const ticketGetArgs = z.object({
  id: z.string().describe('Ticket id.'),
})

const ticketCreateArgs = z.object({
  title:       z.string().describe('Short title.'),
  description: z.string().describe('Full description, markdown allowed.'),
  agent_id:    z.string().optional().describe('Optional: assign to a specific agent by id. Use agentsList first to discover ids.'),
  depends_on:  z.string().optional().describe('Optional: id of a ticket this one depends on. Will not dispatch until the dependency is finished.'),
})

const verdictReportArgs = z.object({
  pass:   z.boolean().describe('true = the work meets the acceptance criteria; false = it does not.'),
  reason: z.string().describe('Brief explanation. On fail, name the specific criterion that failed and what the producer should fix.'),
})

const ticketCommentArgs = z.object({
  ticket_id:   z.string().optional().describe('Ticket to comment on. Defaults to the current session\'s ticket.'),
  body:        z.string().describe('Comment body, markdown allowed.'),
  attachments: z.array(z.string()).optional().describe('Optional list of workspace-relative file paths to attach (png/jpg/webp/gif/pdf, 10 MB max each).'),
})

const ticketCancelArgs = z.object({
  ticket_id: z.string().describe('Ticket id to cancel.'),
})

const ticketTagAddArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current session\'s ticket.'),
  tag:       z.string().describe('Tag to add (lowercase, max 50 chars).'),
})

const ticketTagRemoveArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current session\'s ticket.'),
  tag:       z.string().describe('Tag to remove.'),
})

const agentsListArgs  = z.object({})
const sessionListArgs = z.object({
  ticket_id: z.string().optional().describe('Ticket id. Defaults to the current ticket.'),
})
const connectionListArgs = z.object({})
const thinkArgs        = z.object({
  thought: z.string().describe('The reasoning step.'),
})
const attachmentGetArgs = z.object({
  id: z.string().describe('Attachment id (listed in the opening prompt).'),
})

// ── Internal API helper ──
// All foundry tools curl back to the service through the sandbox. The
// internal bearer token authenticates the call without needing a user
// session cookie. mount='none' because foundry tools don't need workspace
// state; network=true because they need to reach the host.

// Bearer-token requests have no session cookie, so handlers fall back to
// `?accountId=` to resolve identity. Inject the calling sandbox's owning
// account on every internal call so the protected route handlers can
// enforce ownership. (Phase 5 replaces this with a per-session token.)
function withAccount(ctx: FoundryCtx, path: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}accountId=${encodeURIComponent(ctx.accountId)}`
}

async function apiGet(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string) {
  const url = withAccount(ctx, path)
  const command = `curl -sf -H "Authorization: Bearer $TOKEN" "http://host.containers.internal:${ctx.config.port}${url}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      env:       { TOKEN: ctx.sandboxToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

async function apiPost(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string, body: string) {
  const url = withAccount(ctx, path)
  const command = `curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d ${esc(body)} "http://host.containers.internal:${ctx.config.port}${url}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      env:       { TOKEN: ctx.sandboxToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

// Upload a file from the session workspace via curl --data-binary. The
// workspace is bind-mounted into the container at /home/foundry, so relative
// paths in the agent's args resolve cleanly.
async function apiUploadFile(
  ctx: FoundryCtx, toolName: string, toolInput: unknown,
  path: string, workspacePath: string, mime: string,
) {
  const url = withAccount(ctx, path)
  const command = [
    `curl -sf -X POST`,
    `-H "Authorization: Bearer $TOKEN"`,
    `-H "Content-Type: ${mime}"`,
    `--data-binary @${esc(`/home/foundry/${workspacePath}`)}`,
    `"http://host.containers.internal:${ctx.config.port}${url}"`,
  ].join(' ')
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      env:       { TOKEN: ctx.sandboxToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `upload failed (exit ${r.exitCode})` }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
}
function mimeFromPath(p: string): string | null {
  const ext = p.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? null
}

async function apiDelete(ctx: FoundryCtx, toolName: string, toolInput: unknown, path: string) {
  const url = withAccount(ctx, path)
  const command = `curl -sf -X DELETE -H "Authorization: Bearer $TOKEN" "http://host.containers.internal:${ctx.config.port}${url}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, toolInput, {
      env:       { TOKEN: ctx.sandboxToken },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout || `API call failed (exit ${r.exitCode})` }
  if (!r.stdout.trim()) return { ok: true }
  try { return JSON.parse(r.stdout) } catch { return { content: r.stdout } }
}

// ── Handlers ──

async function handleTicketList(ctx: FoundryCtx, args: z.infer<typeof ticketListArgs>) {
  const qs = new URLSearchParams({ projectId: ctx.projectId })
  if (args.status)   qs.set('status',  args.status)
  if (args.agent_id) qs.set('agentId', args.agent_id)
  if (args.tag)      qs.set('tag',     args.tag)
  return apiGet(ctx, 'ticketList', args, `/ticket?${qs}`)
}

async function handleTicketGet(ctx: FoundryCtx, args: z.infer<typeof ticketGetArgs>) {
  const ticket = await apiGet(ctx, 'ticketGet', args, `/ticket/${args.id}`)
  if (ticket.error) return ticket
  const tags = await apiGet(ctx, 'ticketGet', args, `/ticket/${args.id}/tag`)
  return { ...ticket, tags: Array.isArray(tags) ? tags.map((t: any) => t.tag) : [] }
}

async function handleTicketCreate(ctx: FoundryCtx, args: z.infer<typeof ticketCreateArgs>) {
  const payload = JSON.stringify({
    project_id:  ctx.projectId,
    created_by:  ctx.agentName,
    title:       args.title,
    description: args.description,
    ...(args.agent_id   ? { agent_id:   args.agent_id   } : {}),
    ...(args.depends_on ? { depends_on: args.depends_on } : {}),
  })
  return apiPost(ctx, 'ticketCreate', args, '/ticket', payload)
}

// Verdict is written onto the verifier's session row (verdict_pass /
// verdict_reason) via the normal sandbox → HTTP round trip, so the tool
// call gets the same execution-row treatment as every other tool. The
// verify dance reads it back via verdictBySession; the next producer
// sees prior verdicts on the ticket in its system prompt.
async function handleVerdictReport(ctx: FoundryCtx, args: z.infer<typeof verdictReportArgs>) {
  const payload = JSON.stringify({ pass: args.pass, reason: args.reason })
  return apiPost(ctx, 'verdictReport', args, `/session/${ctx.sessionId}/verdict`, payload)
}

async function handleTicketComment(ctx: FoundryCtx, args: z.infer<typeof ticketCommentArgs>) {
  const targetTicket = args.ticket_id ?? ctx.ticketId
  const payload = JSON.stringify({ author: ctx.agentName, body: args.body })
  const resp = await apiPost(ctx, 'ticketComment', args, `/ticket/${targetTicket}/comment`, payload)
  // Attach each file from the session workspace to the newly-created
  // comment. Errors on individual files don't block the rest.
  const paths = args.attachments ?? []
  if (paths.length === 0) return resp
  const commentId = (resp as { id?: string } | undefined)?.id
  if (!commentId) return resp
  const uploaded: Array<{ path: string; id?: string; error?: string }> = []
  for (const p of paths) {
    const mime = mimeFromPath(p)
    if (!mime) { uploaded.push({ path: p, error: 'unsupported file type' }); continue }
    const name = p.split('/').pop() ?? 'attachment'
    const url = `/comment/${commentId}/attachment?name=${encodeURIComponent(name)}&created_by=${encodeURIComponent(ctx.agentName)}`
    const r = await apiUploadFile(ctx, 'ticketComment', { path: p }, url, p, mime) as { id?: string; error?: string }
    if (r.error) uploaded.push({ path: p, error: r.error })
    else uploaded.push({ path: p, id: r.id })
  }
  return { ...(resp as Record<string, unknown>), attachments: uploaded }
}

async function handleTicketCancel(ctx: FoundryCtx, args: z.infer<typeof ticketCancelArgs>) {
  return apiPost(ctx, 'ticketCancel', args, `/ticket/${args.ticket_id}/cancel`, '')
}

async function handleTicketTagAdd(ctx: FoundryCtx, args: z.infer<typeof ticketTagAddArgs>) {
  const ticketId = args.ticket_id ?? ctx.ticketId
  const payload = JSON.stringify({ tag: args.tag })
  return apiPost(ctx, 'ticketTagAdd', args, `/ticket/${ticketId}/tag`, payload)
}

async function handleTicketTagRemove(ctx: FoundryCtx, args: z.infer<typeof ticketTagRemoveArgs>) {
  const ticketId = args.ticket_id ?? ctx.ticketId
  return apiDelete(ctx, 'ticketTagRemove', args, `/ticket/${ticketId}/tag/${encodeURIComponent(args.tag)}`)
}

async function handleAgentsList(ctx: FoundryCtx, _args: z.infer<typeof agentsListArgs>) {
  return apiGet(ctx, 'agentsList', _args, `/agent`)
}

async function handleSessionList(ctx: FoundryCtx, args: z.infer<typeof sessionListArgs>) {
  const tid = args.ticket_id ?? ctx.ticketId
  return apiGet(ctx, 'sessionList', args, `/ticket/${tid}/session`)
}

async function handleConnectionList(ctx: FoundryCtx, _args: z.infer<typeof connectionListArgs>) {
  return apiGet(ctx, 'connectionList', _args, `/connection`)
}

async function handleThink(ctx: FoundryCtx, args: z.infer<typeof thinkArgs>) {
  // Think is a no-op but still goes through the sandbox for consistency.
  // The container boots, echoes "ok", dies. Gives a real execution row
  // with timing for how long the model spent on this reasoning step.
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'echo ok', 'think', args, { toolUseId: ctx.toolUseId })
  return { ok: r.exitCode === 0 }
}

// Load an attachment's bytes as an image/document content block so the
// model can actually see it. Opening prompt lists ids + metadata only;
// this tool is how agents pull the actual pixels/PDF on demand.
async function handleAttachmentGet(ctx: FoundryCtx, args: z.infer<typeof attachmentGetArgs>) {
  const { attachmentGetInternal } = await import('../../../attachments/service.js')
  const { asImage } = await import('../../../integrations/shared.js')
  const att = attachmentGetInternal(ctx.db, args.id)
  if (!att) return { error: `attachment ${args.id} not found` }
  // Images render as image blocks; PDFs go through document blocks.
  // (Claude's document support is the 'document' type with a base64
  // source of media_type application/pdf — SDK accepts this.)
  if (att.mime.startsWith('image/')) return asImage(att.bytes, att.mime)
  return {
    content: [{
      type: 'document',
      source: { type: 'base64', media_type: att.mime, data: att.bytes.toString('base64') },
    }],
  }
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'foundry',
  name:        'Foundry',
  category:    'core',
  description: 'Foundry harness introspection: tickets, agents, sessions, connections.',
}

export const tools: ToolDef[] = [
  { name: 'ticketList',      description: 'List tickets in the current project. Filter by status (created/waiting/running/finished/failed/cancelled), agent, or tag.',                                                                  schema: ticketListArgs,      handler: handleTicketList },
  { name: 'ticketGet',       description: 'Fetch a ticket by id including its title, body, status, dependency, and tags.',                                                                                                              schema: ticketGetArgs,       handler: handleTicketGet },
  { name: 'ticketCreate',    description: 'Create a new ticket in the current project. Use `depends_on` to sequence work — the new ticket won\'t dispatch until the dependency is finished. Use tags for grouping.',                     schema: ticketCreateArgs,    handler: handleTicketCreate },
  { name: 'ticketComment',   description: 'Post a comment on a ticket. Used for status updates, questions, or communicating with the Founder.',                                                                                         schema: ticketCommentArgs,   handler: handleTicketComment },
  { name: 'ticketCancel',    description: 'Cancel a ticket. Works on any non-terminal ticket.',                                                                                                                                         schema: ticketCancelArgs,    handler: handleTicketCancel },
  { name: 'verdictReport',   description: 'Verifier-only. After reviewing the ticket payload + comments, call this exactly once with pass=true if the work meets acceptance criteria, or pass=false with a reason. Producer agents must NOT call this.', schema: verdictReportArgs, handler: handleVerdictReport },
  { name: 'ticketTagAdd',    description: 'Add a tag to a ticket.',                                                                                                                                                                     schema: ticketTagAddArgs,    handler: handleTicketTagAdd },
  { name: 'ticketTagRemove', description: 'Remove a tag from a ticket.',                                                                                                                                                                schema: ticketTagRemoveArgs, handler: handleTicketTagRemove },
  { name: 'agentsList',      description: 'List agents configured in the account. Useful for targeting tickets at a specific agent.',                                                                                                   schema: agentsListArgs,      handler: handleAgentsList },
  { name: 'sessionList',     description: 'List agent sessions for a ticket. Defaults to the current session\'s ticket if omitted.',                                                                                                    schema: sessionListArgs,     handler: handleSessionList },
  { name: 'connectionList',  description: 'List configured external connections (LLM backends, integrations). Secrets are masked.',                                                                                                     schema: connectionListArgs,  handler: handleConnectionList },
  { name: 'think',           description: 'Use this tool to reason, plan, or analyze before taking action. No side effects. Still runs in the sandbox for consistent execution tracking.',                                              schema: thinkArgs,           handler: handleThink },
  { name: 'attachmentGet',   description: 'Load an attachment (image or PDF) from the current ticket. The opening prompt lists attachment ids; call this only when you actually need to see the content.',                                schema: attachmentGetArgs,   handler: handleAttachmentGet },
]
