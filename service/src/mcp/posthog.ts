// PostHog — analytics + feature flags. Skeleton: ping only. Extend with
// captureEvent and featureFlagCheck in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'posthog',
  name:        'PostHog',
  category:    'product',
  description: 'Product analytics and feature flags.',
  tools: [
    { name: 'ping', description: 'Verify credentials by fetching the project.' },
  ],
}

type PosthogCtx = ConnCtx

const pingArgs = z.object({})

function host(ctx: PosthogCtx): string {
  const h = typeof ctx.connConfig.host === 'string' ? ctx.connConfig.host.trim() : ''
  return (h || (ctx.secrets.host ?? '') || 'https://us.i.posthog.com').replace(/\/+$/, '')
}

async function handlePing(ctx: PosthogCtx, args: z.infer<typeof pingArgs>) {
  const projectId = ctx.secrets.project_id ?? ''
  const cmd = `curl -sf -H "Authorization: Bearer $API_KEY" "${host(ctx)}/api/projects/${encodeURIComponent(projectId)}/"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { API_KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  ping: 'Verify the personal API key + project id by fetching the project.',
}

export function buildSdk(ctx: PosthogCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): PosthogCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `posthog:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: PosthogCtx) {
  return {
    [`posthog-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
