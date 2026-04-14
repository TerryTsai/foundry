// UptimeRobot — uptime monitoring. Skeleton: ping only. Extend with
// monitorList, monitorCreate, monitorPause in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'uptimerobot',
  name:        'UptimeRobot',
  category:    'product',
  description: 'HTTP / ping uptime monitoring.',
  tools: [
    { name: 'ping', description: 'Verify the API key via getAccountDetails.' },
  ],
}

type UptimeRobotCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: UptimeRobotCtx, args: z.infer<typeof pingArgs>) {
  // UptimeRobot v2: POST form with api_key=<key>&format=json.
  const cmd = 'curl -sf -X POST --data-urlencode "api_key=$KEY" --data-urlencode "format=json" "https://api.uptimerobot.com/v2/getAccountDetails"'
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
  ping: 'Verify the API key by fetching account details.',
}

export function buildSdk(ctx: UptimeRobotCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): UptimeRobotCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `uptimerobot:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: UptimeRobotCtx) {
  return {
    [`uptimerobot-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
