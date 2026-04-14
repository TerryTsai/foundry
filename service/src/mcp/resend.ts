// Resend — transactional email. Sends via the Resend API; credentials
// come from the connection row.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'resend',
  name:        'Resend',
  category:    'growth',
  description: 'Transactional email.',
  tools: [
    { name: 'sendEmail', description: 'Send a transactional email.' },
    { name: 'getEmail',  description: 'Fetch a previously-sent email by id.' },
    { name: 'ping',      description: 'Verify the API key.' },
  ],
}

type ResendCtx = ConnCtx

const sendEmailArgs = z.object({
  to:       z.union([z.string(), z.array(z.string())]).describe('Recipient(s). Single string or array.'),
  subject:  z.string().describe('Subject line.'),
  html:     z.string().optional().describe('HTML body. Include this or `text` (or both).'),
  text:     z.string().optional().describe('Plain-text body.'),
  from:     z.string().optional().describe('From address. Defaults to the connection\'s default_from.'),
  reply_to: z.union([z.string(), z.array(z.string())]).optional(),
  cc:       z.union([z.string(), z.array(z.string())]).optional(),
  bcc:      z.union([z.string(), z.array(z.string())]).optional(),
})
const getEmailArgs = z.object({
  id: z.string().describe('Email id returned by sendEmail.'),
})
const pingArgs     = z.object({})

// Thin wrapper around runCommand for all Resend API calls. The token rides
// in env; the command string contains only `$API_KEY` expansions so the
// execution row is safe to persist.
async function api(ctx: ResendCtx, toolName: string, args: unknown, method: 'GET' | 'POST', path: string, body?: unknown) {
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} -H "Authorization: Bearer $API_KEY" "https://api.resend.com${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { API_KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleSendEmail(ctx: ResendCtx, args: z.infer<typeof sendEmailArgs>) {
  if (!args.html && !args.text) return { ok: false, error: 'provide html, text, or both' }
  const from = args.from
            ?? (typeof ctx.connConfig.default_from === 'string' ? ctx.connConfig.default_from : '')
            ?? ''
  if (!from) return { ok: false, error: 'from address required — pass `from` or set default_from on the connection' }
  return api(ctx, 'sendEmail', args, 'POST', '/emails', { ...args, from })
}

async function handleGetEmail(ctx: ResendCtx, args: z.infer<typeof getEmailArgs>) {
  return api(ctx, 'getEmail', args, 'GET', `/emails/${encodeURIComponent(args.id)}`)
}

async function handlePing(ctx: ResendCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', '/api-keys')
}

const DESC = {
  sendEmail: 'Send a transactional email. At least one of `html` or `text` is required. `from` may be omitted if the connection has default_from set (must be a verified sender domain). Returns { id } on success.',
  getEmail:  'Fetch a previously-sent email\'s delivery status and metadata.',
  ping:      'Verify the API key by listing the account\'s keys.',
}

export function buildSdk(ctx: ResendCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): ResendCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('sendEmail', DESC.sendEmail, sendEmailArgs.shape, async (a, x) => asText(await handleSendEmail(tu(x), a))),
    sdkTool('getEmail',  DESC.getEmail,  getEmailArgs.shape,  async (a, x) => asText(await handleGetEmail(tu(x), a))),
    sdkTool('ping',      DESC.ping,      pingArgs.shape,      async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `resend:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: ResendCtx) {
  const p = `resend-${ctx.connectionName}`
  return {
    [`${p}-sendEmail`]: tool({ description: DESC.sendEmail, inputSchema: sendEmailArgs, execute: a => handleSendEmail(ctx, a) }),
    [`${p}-getEmail`]:  tool({ description: DESC.getEmail,  inputSchema: getEmailArgs,  execute: a => handleGetEmail(ctx, a) }),
    [`${p}-ping`]:      tool({ description: DESC.ping,      inputSchema: pingArgs,      execute: a => handlePing(ctx, a) }),
  }
}
