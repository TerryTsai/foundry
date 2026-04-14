// Resend — transactional email. Skeleton: ping only. Extend with sendEmail
// in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'resend',
  name:        'Resend',
  category:    'growth',
  description: 'Transactional email via Resend.',
  tools: [
    { name: 'ping', description: 'Verify the API key by listing the account\'s keys.' },
  ],
}

type ResendCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: ResendCtx, args: z.infer<typeof pingArgs>) {
  const cmd = 'curl -sf -w "\\n%{http_code}" -H "Authorization: Bearer $API_KEY" "https://api.resend.com/api-keys"'
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { API_KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, stdout: r.stdout }
}

const DESC = {
  ping: 'Verify the API key. Returns the authenticated account\'s key list.',
}

export function buildSdk(ctx: ResendCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): ResendCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `resend:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: ResendCtx) {
  return {
    [`resend-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
