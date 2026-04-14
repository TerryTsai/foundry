// Supabase — Postgres, Auth, Storage, Edge Functions. Skeleton: ping only.
// Extend with sqlQuery, authList, storageUpload in Phase B.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'supabase',
  name:        'Supabase',
  category:    'data',
  description: 'Postgres, auth, storage, and edge functions.',
  tools: [
    { name: 'ping', description: 'Verify credentials against the REST root.' },
  ],
}

type SupabaseCtx = ConnCtx

const pingArgs = z.object({})

async function handlePing(ctx: SupabaseCtx, args: z.infer<typeof pingArgs>) {
  const url = (ctx.secrets.project_url ?? '').replace(/\/+$/, '')
  const cmd = `curl -sf -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "${url}/rest/v1/"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'ping', args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.service_role_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, stdout: r.stdout.slice(0, 500) }
}

const DESC = {
  ping: 'Verify the project URL + service_role key.',
}

export function buildSdk(ctx: SupabaseCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): SupabaseCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('ping', DESC.ping, pingArgs.shape, async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `supabase:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: SupabaseCtx) {
  return {
    [`supabase-${ctx.connectionName}-ping`]: tool({
      description: DESC.ping, inputSchema: pingArgs,
      execute: (a: z.infer<typeof pingArgs>) => handlePing(ctx, a),
    }),
  }
}
