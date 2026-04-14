// PostHog — product analytics and feature flags. Personal API key
// authenticates admin operations (HogQL queries, feature flag CRUD).
// Event capture requires the project API key and is intentionally
// omitted here — capture is almost always done from the client SDK.

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
    { name: 'queryHogQL',       description: 'Run a HogQL (SQL) query against the project.' },
    { name: 'featureFlagList',  description: 'List feature flags on the project.' },
    { name: 'featureFlagGet',   description: 'Fetch one feature flag by key.' },
    { name: 'ping',             description: 'Verify credentials by fetching the project.' },
  ],
}

type PosthogCtx = ConnCtx

function host(ctx: PosthogCtx): string {
  const h = typeof ctx.connConfig.host === 'string' ? ctx.connConfig.host.trim() : ''
  return (h || 'https://us.i.posthog.com').replace(/\/+$/, '')
}
function projectId(ctx: PosthogCtx): string {
  return ctx.secrets.project_id ?? ''
}

const queryHogQLArgs = z.object({
  query: z.string().describe('HogQL query. Example: `SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY GROUP BY event ORDER BY count() DESC LIMIT 20`.'),
})
const featureFlagListArgs = z.object({
  limit: z.number().int().min(1).max(100).optional(),
})
const featureFlagGetArgs = z.object({
  key: z.string().describe('Flag key (e.g. "new-checkout").'),
})
const pingArgs = z.object({})

async function api(ctx: PosthogCtx, toolName: string, args: unknown, method: 'GET' | 'POST', path: string, body?: unknown) {
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} -H "Authorization: Bearer $API_KEY" "${host(ctx)}${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { API_KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleQueryHogQL(ctx: PosthogCtx, args: z.infer<typeof queryHogQLArgs>) {
  return api(ctx, 'queryHogQL', args, 'POST', `/api/projects/${encodeURIComponent(projectId(ctx))}/query/`,
    { query: { kind: 'HogQLQuery', query: args.query } })
}

async function handleFeatureFlagList(ctx: PosthogCtx, args: z.infer<typeof featureFlagListArgs>) {
  const qs = args.limit ? `?limit=${args.limit}` : ''
  return api(ctx, 'featureFlagList', args, 'GET', `/api/projects/${encodeURIComponent(projectId(ctx))}/feature_flags/${qs}`)
}

async function handleFeatureFlagGet(ctx: PosthogCtx, args: z.infer<typeof featureFlagGetArgs>) {
  // The list endpoint supports ?search= but there's no direct get-by-key.
  // Filter in-app for the matching key.
  const r = await api(ctx, 'featureFlagGet', args, 'GET', `/api/projects/${encodeURIComponent(projectId(ctx))}/feature_flags/?search=${encodeURIComponent(args.key)}`)
  if (!r.ok) return r
  const flags = (r.result as { results?: Array<{ key: string }> } | undefined)?.results ?? []
  const match = flags.find(f => f.key === args.key)
  return match ? { ok: true as const, result: match } : { ok: false as const, error: `flag '${args.key}' not found` }
}

async function handlePing(ctx: PosthogCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', `/api/projects/${encodeURIComponent(projectId(ctx))}/`)
}

const DESC = {
  queryHogQL:      'Run a HogQL query. HogQL is SQL against the events/persons/sessions tables. Returns { results, types, columns }.',
  featureFlagList: 'List feature flags on the project. Pass `limit` to cap the page size.',
  featureFlagGet:  'Fetch a feature flag\'s current config by key.',
  ping:            'Verify the personal API key + project id by fetching the project.',
}

export function buildSdk(ctx: PosthogCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): PosthogCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('queryHogQL',      DESC.queryHogQL,      queryHogQLArgs.shape,      async (a, x) => asText(await handleQueryHogQL(tu(x), a))),
    sdkTool('featureFlagList', DESC.featureFlagList, featureFlagListArgs.shape, async (a, x) => asText(await handleFeatureFlagList(tu(x), a))),
    sdkTool('featureFlagGet',  DESC.featureFlagGet,  featureFlagGetArgs.shape,  async (a, x) => asText(await handleFeatureFlagGet(tu(x), a))),
    sdkTool('ping',            DESC.ping,            pingArgs.shape,            async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `posthog:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: PosthogCtx) {
  const p = `posthog-${ctx.connectionName}`
  return {
    [`${p}-queryHogQL`]:      tool({ description: DESC.queryHogQL,      inputSchema: queryHogQLArgs,      execute: a => handleQueryHogQL(ctx, a) }),
    [`${p}-featureFlagList`]: tool({ description: DESC.featureFlagList, inputSchema: featureFlagListArgs, execute: a => handleFeatureFlagList(ctx, a) }),
    [`${p}-featureFlagGet`]:  tool({ description: DESC.featureFlagGet,  inputSchema: featureFlagGetArgs,  execute: a => handleFeatureFlagGet(ctx, a) }),
    [`${p}-ping`]:            tool({ description: DESC.ping,            inputSchema: pingArgs,            execute: a => handlePing(ctx, a) }),
  }
}
