// Crisp — customer chat. Plugin-tier auth (identifier + key) via HTTP
// Basic. Conversation endpoints are scoped by website_id.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'crisp',
  name:        'Crisp',
  category:    'growth',
  description: 'Customer chat conversations.',
  tools: [
    { name: 'conversationList',  description: 'List conversations on the website.' },
    { name: 'conversationGet',   description: 'Fetch one conversation.' },
    { name: 'conversationSend',  description: 'Post a message into a conversation as the operator.' },
    { name: 'conversationClose', description: 'Set a conversation\'s state to resolved.' },
    { name: 'ping',              description: 'Verify credentials.' },
  ],
}

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

const DESC = {
  conversationList:  'List conversations on the website (paginated, 1-indexed). `search_query` + `search_type` filter by text/email/phone/session_id.',
  conversationGet:   'Fetch one conversation\'s metadata (participant, last message, state, assigned operator).',
  conversationSend:  'Post a plain-text operator message into a conversation.',
  conversationClose: 'Mark a conversation resolved. The visitor can reopen it by replying.',
  ping:              'Verify identifier + key + website_id by fetching the website record.',
}

export function buildSdk(ctx: CrispCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CrispCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('conversationList',  DESC.conversationList,  conversationListArgs.shape,  async (a, x) => asText(await handleConversationList(tu(x), a))),
    sdkTool('conversationGet',   DESC.conversationGet,   conversationGetArgs.shape,   async (a, x) => asText(await handleConversationGet(tu(x), a))),
    sdkTool('conversationSend',  DESC.conversationSend,  conversationSendArgs.shape,  async (a, x) => asText(await handleConversationSend(tu(x), a))),
    sdkTool('conversationClose', DESC.conversationClose, conversationCloseArgs.shape, async (a, x) => asText(await handleConversationClose(tu(x), a))),
    sdkTool('ping',              DESC.ping,              pingArgs.shape,              async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `crisp:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: CrispCtx) {
  const p = `crisp-${ctx.connectionName}`
  return {
    [`${p}-conversationList`]:  tool({ description: DESC.conversationList,  inputSchema: conversationListArgs,  execute: a => handleConversationList(ctx, a) }),
    [`${p}-conversationGet`]:   tool({ description: DESC.conversationGet,   inputSchema: conversationGetArgs,   execute: a => handleConversationGet(ctx, a) }),
    [`${p}-conversationSend`]:  tool({ description: DESC.conversationSend,  inputSchema: conversationSendArgs,  execute: a => handleConversationSend(ctx, a) }),
    [`${p}-conversationClose`]: tool({ description: DESC.conversationClose, inputSchema: conversationCloseArgs, execute: a => handleConversationClose(ctx, a) }),
    [`${p}-ping`]:              tool({ description: DESC.ping,              inputSchema: pingArgs,              execute: a => handlePing(ctx, a) }),
  }
}
