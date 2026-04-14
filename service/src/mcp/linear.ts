// Linear — issue tracking. Skeleton: ping only. Extend with issueList,
// issueGet, issueCreate, issueUpdate via GraphQL in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'linear',
  name:        'Linear',
  category:    'code',
  description: 'Issue tracking and product planning.',
  tools: [
    { name: 'ping', description: 'Verify the API key via the viewer GraphQL query.' },
  ],
}

type LinearCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: LinearCtx, args: z.infer<typeof pingArgs>) {
  // Linear expects the raw API key in Authorization (no "Bearer " prefix).
  const cmd = `curl -sf -X POST -H "Authorization: $KEY" -H "Content-Type: application/json" --data '{"query":"{ viewer { id name email } }"}' "https://api.linear.app/graphql"`
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
  ping: 'Verify the API key with a `viewer` GraphQL query.',
}

export function buildSdk(ctx: LinearCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): LinearCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `linear:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: LinearCtx) {
  return {
    [`linear-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
