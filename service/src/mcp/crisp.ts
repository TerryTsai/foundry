// Crisp — customer chat. Skeleton: ping only. Extend with conversationList,
// conversationSend, conversationClose in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'crisp',
  name:        'Crisp',
  category:    'growth',
  description: 'Customer chat and conversations.',
  tools: [
    { name: 'ping', description: 'Verify credentials by fetching the website metadata.' },
  ],
}

type CrispCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: CrispCtx, args: z.infer<typeof pingArgs>) {
  // Crisp uses HTTP Basic with identifier:key and X-Crisp-Tier: plugin.
  const websiteId = ctx.secrets.website_id ?? ''
  const cmd = `curl -sf -u "$ID:$KEY" -H "X-Crisp-Tier: plugin" "https://api.crisp.chat/v1/website/${encodeURIComponent(websiteId)}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { ID: ctx.secrets.identifier ?? '', KEY: ctx.secrets.key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  ping: 'Verify identifier + key + website_id by fetching the website.',
}

export function buildSdk(ctx: CrispCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CrispCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `crisp:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: CrispCtx) {
  return {
    [`crisp-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
