// Clerk — auth. Skeleton: ping only. Extend with userList, userGet,
// userUpdate, userBan in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'clerk',
  name:        'Clerk',
  category:    'growth',
  description: 'User auth (sessions, profiles, orgs).',
  tools: [
    { name: 'ping', description: 'Verify the secret key by listing one user.' },
  ],
}

type ClerkCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: ClerkCtx, args: z.infer<typeof pingArgs>) {
  const cmd = 'curl -sf -H "Authorization: Bearer $KEY" "https://api.clerk.com/v1/users?limit=1"'
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
  ping: 'Verify the secret key by fetching one user.',
}

export function buildSdk(ctx: ClerkCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): ClerkCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `clerk:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: ClerkCtx) {
  return {
    [`clerk-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
