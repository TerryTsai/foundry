// Sentry — error tracking. Skeleton: ping only. Extend with listIssues,
// getIssue, resolveIssue in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'sentry',
  name:        'Sentry',
  category:    'product',
  description: 'Error tracking and performance monitoring.',
  tools: [
    { name: 'ping', description: 'Verify credentials by fetching the organization.' },
  ],
}

type SentryCtx = ConnCtx

const pingArgs = z.object({})

function host(ctx: SentryCtx): string {
  const h = typeof ctx.connConfig.host === 'string' ? ctx.connConfig.host.trim() : ''
  return (h || 'https://sentry.io').replace(/\/+$/, '')
}

async function handlePing(ctx: SentryCtx, args: z.infer<typeof pingArgs>) {
  const org = ctx.secrets.organization ?? (typeof ctx.connConfig.organization === 'string' ? ctx.connConfig.organization : '')
  const cmd = `curl -sf -H "Authorization: Bearer $TOKEN" "${host(ctx)}/api/0/organizations/${encodeURIComponent(org)}/"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { TOKEN: ctx.secrets.auth_token ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  ping: 'Verify the auth token + organization by fetching the organization.',
}

export function buildSdk(ctx: SentryCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): SentryCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `sentry:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: SentryCtx) {
  return {
    [`sentry-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
