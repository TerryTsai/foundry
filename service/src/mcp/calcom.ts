// Cal.com — scheduling. Skeleton: ping only. Extend with bookingList,
// eventTypeList, availability in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'calcom',
  name:        'Cal.com',
  category:    'growth',
  description: 'Scheduling, event types, and bookings.',
  tools: [
    { name: 'ping', description: 'Verify the API key via /me.' },
  ],
}

type CalcomCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: CalcomCtx, args: z.infer<typeof pingArgs>) {
  // Cal.com v1 uses ?apiKey=<key> query-string auth.
  const cmd = 'curl -sf "https://api.cal.com/v1/me?apiKey=$KEY"'
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  ping: 'Verify the API key by fetching the authenticated user.',
}

export function buildSdk(ctx: CalcomCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CalcomCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `calcom:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: CalcomCtx) {
  return {
    [`calcom-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
