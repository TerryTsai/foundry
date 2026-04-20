// Resend — transactional email.

import { z } from 'zod'

import { runCommand, type ConnCtx } from '../shared.js'
import type { McpServerInfo, ToolDef } from '../types.js'

type ResendCtx = ConnCtx

// ── Schemas ──

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
const pingArgs = z.object({})

// ── Handlers ──

async function api(ctx: ResendCtx, toolName: string, args: unknown, method: 'GET' | 'POST', path: string, body?: unknown) {
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} -H "Authorization: Bearer $API_KEY" "https://api.resend.com${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      env:       { API_KEY: ctx.secrets.api_key ?? '' },
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

async function handlePing(ctx: ResendCtx, _args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', _args, 'GET', '/api-keys')
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'resend',
  name:        'Resend',
  category:    'growth',
  description: 'Transactional email.',
}

export const tools: ToolDef[] = [
  { name: 'sendEmail', description: 'Send a transactional email. At least one of `html` or `text` is required. `from` may be omitted if the connection has default_from set. Returns { id } on success.', schema: sendEmailArgs, handler: handleSendEmail },
  { name: 'getEmail',  description: 'Fetch a previously-sent email\'s delivery status and metadata.',                                                                                                     schema: getEmailArgs,  handler: handleGetEmail },
  { name: 'ping',      description: 'Verify the API key by listing the account\'s keys.',                                                                                                                schema: pingArgs,      handler: handlePing },
]
