// Stripe — payments. Skeleton: ping only. Extend with customerList,
// customerCreate, checkoutCreate, subscriptionList in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'stripe',
  name:        'Stripe',
  category:    'growth',
  description: 'Payments, subscriptions, and checkout.',
  tools: [
    { name: 'ping', description: 'Verify the secret key by fetching the account.' },
  ],
}

type StripeCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: StripeCtx, args: z.infer<typeof pingArgs>) {
  // Stripe uses HTTP Basic with the secret key as username, empty password.
  const cmd = 'curl -sf -u "$KEY:" "https://api.stripe.com/v1/account"'
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.secret_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  ping: 'Verify the secret key by fetching account details.',
}

export function buildSdk(ctx: StripeCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): StripeCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `stripe:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: StripeCtx) {
  return {
    [`stripe-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
