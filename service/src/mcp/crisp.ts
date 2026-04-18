// Crisp — customer chat. Plugin-tier auth (identifier + key) via HTTP
// Basic. Conversation endpoints are scoped by website_id.

import { z } from 'zod'

import { runCommand, type ConnCtx } from './shared.js'
import type { McpServerInfo, ToolDef } from './registry.js'

type CrispCtx = ConnCtx

function website(ctx: CrispCtx): string {
  return ctx.secrets.website_id ?? ''
}

const conversationListArgs = z.object({
  page:           z.number().int().min(1).optional().describe('Page number, default 1.'),
  search_query:   z.string().optional(),
  search_type:    z.enum(['session_id', 'text', 'email', 'phone']).optional(),
})
const conversationGetArgs = z.object({
  session_id: z.string().describe('Conversation session id (session_…).'),
})
const conversationSendArgs = z.object({
  session_id: z.string().describe('Conversation session id.'),
  text:       z.string().describe('Message body.'),
})
const conversationCloseArgs = z.object({
  session_id: z.string().describe('Conversation session id.'),
})
const pingArgs = z.object({})

async function api(ctx: CrispCtx, toolName: string, args: unknown, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) {
  const headers = ['-u "$ID:$KEY"', '-H "X-Crisp-Tier: plugin"']
  if (body !== undefined) headers.push('-H "Content-Type: application/json"')
  const bodyFlag = body !== undefined ? ` --data ${JSON.stringify(JSON.stringify(body))}` : ''
  const cmd = `curl -sf -X ${method} ${headers.join(' ')} "https://api.crisp.chat/v1${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { ID: ctx.secrets.identifier ?? '', KEY: ctx.secrets.key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleConversationList(ctx: CrispCtx, args: z.infer<typeof conversationListArgs>) {
  const qs = new URLSearchParams()
  if (args.search_query) qs.set('search_query', args.search_query)
  if (args.search_type)  qs.set('search_type',  args.search_type)
  const page = args.page ?? 1
  const q = qs.toString() ? `?${qs}` : ''
  return api(ctx, 'conversationList', args, 'GET', `/website/${encodeURIComponent(website(ctx))}/conversations/${page}${q}`)
}

async function handleConversationGet(ctx: CrispCtx, args: z.infer<typeof conversationGetArgs>) {
  return api(ctx, 'conversationGet', args, 'GET', `/website/${encodeURIComponent(website(ctx))}/conversation/${encodeURIComponent(args.session_id)}`)
}

async function handleConversationSend(ctx: CrispCtx, args: z.infer<typeof conversationSendArgs>) {
  return api(ctx, 'conversationSend', args, 'POST',
    `/website/${encodeURIComponent(website(ctx))}/conversation/${encodeURIComponent(args.session_id)}/message`,
    { type: 'text', from: 'operator', origin: 'chat', content: args.text })
}

async function handleConversationClose(ctx: CrispCtx, args: z.infer<typeof conversationCloseArgs>) {
  return api(ctx, 'conversationClose', args, 'PATCH',
    `/website/${encodeURIComponent(website(ctx))}/conversation/${encodeURIComponent(args.session_id)}/state`,
    { state: 'resolved' })
}

async function handlePing(ctx: CrispCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', `/website/${encodeURIComponent(website(ctx))}`)
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'crisp',
  name:        'Crisp',
  category:    'growth',
  description: 'Customer chat conversations.',
}

export const tools: ToolDef[] = [
  { name: 'conversationList',  description: 'List conversations on the website (paginated, 1-indexed). `search_query` + `search_type` filter by text/email/phone/session_id.', schema: conversationListArgs,  handler: handleConversationList },
  { name: 'conversationGet',   description: 'Fetch one conversation\'s metadata (participant, last message, state, assigned operator).',                                        schema: conversationGetArgs,   handler: handleConversationGet },
  { name: 'conversationSend',  description: 'Post a plain-text operator message into a conversation.',                                                                          schema: conversationSendArgs,  handler: handleConversationSend },
  { name: 'conversationClose', description: 'Mark a conversation resolved. The visitor can reopen it by replying.',                                                             schema: conversationCloseArgs, handler: handleConversationClose },
  { name: 'ping',              description: 'Verify identifier + key + website_id by fetching the website record.',                                                             schema: pingArgs,              handler: handlePing },
]
