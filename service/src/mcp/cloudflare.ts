// Cloudflare REST API server. Mounted once per cloudflare connection the
// account owns (key `cloudflare:<connection.name>`), not once per session
// like the built-ins. Credentials come from the connection row via ctx.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'cloudflare',
  name:        'Cloudflare',
  category:    'infra',
  description: 'Cloudflare REST API tools: tokens, zones, Pages, cache purge, and Pages deploy.',
  tools: [
    { name: 'whoami',           description: 'Verify the token and show the authorized user / account context.' },
    { name: 'purgeCache',       description: 'Purge cache for a zone. Either a URL list (preferred) or everything.' },
    { name: 'pagesList',        description: 'List Cloudflare Pages projects on the account.' },
    { name: 'pagesDeployments', description: 'List recent deployments for a Pages project.' },
    { name: 'pagesRemove',      description: 'Delete a Cloudflare Pages project. Irreversible.' },
    { name: 'pagesDeploy',      description: 'Deploy a local directory to Cloudflare Pages. Creates the project on first use.' },
  ],
}

type CloudflareCtx = ConnCtx

// ── Schemas ──

const whoamiArgs           = z.object({})
const purgeCacheArgs       = z.object({
  zone_id:          z.string().describe('Zone id (get via zonesList).'),
  files:            z.array(z.string()).optional().describe('URLs to purge. Omit with purge_everything=true.'),
  purge_everything: z.boolean().optional().describe('Purge all cache in the zone.'),
})
const pagesListArgs        = z.object({ account_id: z.string().optional() })
const pagesDeploymentsArgs = z.object({
  project_name: z.string().describe('Pages project name (slug).'),
  account_id:   z.string().optional(),
})
const pagesRemoveArgs      = z.object({
  project_name: z.string().describe('Pages project name (slug) to delete.'),
  account_id:   z.string().optional(),
})
const pagesDeployArgs      = z.object({
  project_name: z.string().describe('Pages project name (slug). Created if missing.'),
  dir:          z.string().describe('Directory to deploy, relative to /work. Must contain the built site (e.g. "site/dist").'),
  branch:       z.string().optional().describe('Deploy branch; default "main".'),
  account_id:   z.string().optional(),
})

// ── Cloudflare request helpers ──

const CF_BASE = 'https://api.cloudflare.com/client/v4'

function curl(method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, body?: unknown): string {
  const parts = [
    'curl', '-sf', '-X', method,
    '-H', '"Authorization: Bearer $CF_TOKEN"',
    '-H', '"Content-Type: application/json"',
  ]
  if (body !== undefined) parts.push('-d', JSON.stringify(JSON.stringify(body)))
  parts.push(`"${CF_BASE}${path}"`)
  return parts.join(' ')
}

// Cloudflare API responses wrap result as { success, errors, messages, result }.
// Unwrap on success; surface errors cleanly.
function parseCfResponse(raw: string): unknown {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { error: 'non-json response', raw } }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    const p = parsed as { success: boolean; result?: unknown; errors?: Array<{ message?: string }> }
    if (!p.success) return { error: p.errors?.map(e => e.message).join('; ') ?? 'cloudflare error' }
    return p.result
  }
  return parsed
}

function resolveAccountId(ctx: CloudflareCtx, override?: string): string {
  const fromArgs = override?.trim()
  if (fromArgs) return fromArgs
  const fromCfg  = typeof ctx.connConfig.account_id === 'string' ? ctx.connConfig.account_id.trim() : ''
  if (fromCfg) return fromCfg
  throw new Error('account_id required — set on the connection or pass as an argument')
}

async function runCf(ctx: CloudflareCtx, toolName: string, args: unknown, command: string) {
  return runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, args, {
      network:   true,
      mount:     'none',
      env:       { CF_TOKEN: ctx.secrets.api_token ?? '' },
      toolUseId: ctx.toolUseId,
    })
}

// ── Handlers ──

async function handleWhoami(ctx: CloudflareCtx, args: z.infer<typeof whoamiArgs>) {
  const r = await runCf(ctx, 'whoami', args, curl('GET', '/user/tokens/verify'))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout || 'request failed' }
  return { ok: true, result: parseCfResponse(r.stdout) }
}

async function handlePurgeCache(ctx: CloudflareCtx, args: z.infer<typeof purgeCacheArgs>) {
  const body = args.purge_everything ? { purge_everything: true } : { files: args.files ?? [] }
  const r = await runCf(ctx, 'purgeCache', args, curl('POST', `/zones/${encodeURIComponent(args.zone_id)}/purge_cache`, body))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, result: parseCfResponse(r.stdout) }
}

async function handlePagesList(ctx: CloudflareCtx, args: z.infer<typeof pagesListArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const r = await runCf(ctx, 'pagesList', args, curl('GET', `/accounts/${encodeURIComponent(acct)}/pages/projects`))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, projects: parseCfResponse(r.stdout) }
}

async function handlePagesDeployments(ctx: CloudflareCtx, args: z.infer<typeof pagesDeploymentsArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const r = await runCf(ctx, 'pagesDeployments', args,
    curl('GET', `/accounts/${encodeURIComponent(acct)}/pages/projects/${encodeURIComponent(args.project_name)}/deployments`))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, deployments: parseCfResponse(r.stdout) }
}

async function handlePagesRemove(ctx: CloudflareCtx, args: z.infer<typeof pagesRemoveArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const r = await runCf(ctx, 'pagesRemove', args,
    curl('DELETE', `/accounts/${encodeURIComponent(acct)}/pages/projects/${encodeURIComponent(args.project_name)}`))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, result: parseCfResponse(r.stdout) }
}

// Wrangler deploy. Isolated workspace — /work not mounted, dir copied
// into /input/dist; wrangler's ephemeral cache dies with the container.
// `pages project create` runs first so missing projects are created
// non-interactively (wrangler errors if absent rather than auto-creating).
async function handlePagesDeploy(ctx: CloudflareCtx, args: z.infer<typeof pagesDeployArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const branch = args.branch ?? 'main'
  const command = [
    'wrangler pages project create',
    JSON.stringify(args.project_name),
    '--production-branch', JSON.stringify(branch),
    '2>/dev/null || true',
    '&&',
    'wrangler pages deploy /input/dist',
    '--project-name', JSON.stringify(args.project_name),
    '--branch',       JSON.stringify(branch),
    '--commit-dirty=true',
  ].join(' ')
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'pagesDeploy', args, {
      network:     true,
      env: {
        CLOUDFLARE_API_TOKEN:  ctx.secrets.api_token ?? '',
        CLOUDFLARE_ACCOUNT_ID: acct,
      },
      artifactsIn: [{ src: args.dir, dest: 'dist' }],
      toolUseId:   ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  const deployMatch = r.stdout.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev/i)
  const deployUrl   = deployMatch?.[0] ?? null
  const projectUrl  = deployUrl ? deployUrl.replace(/^https:\/\/[a-z0-9]+\./i, 'https://') : null
  return { ok: true, deployUrl, projectUrl, stdout: r.stdout }
}

const DESC = {
  whoami:           'Verify the token and show the authorized user / account context.',
  purgeCache:       'Purge cache for a zone. Pass a `files` URL list (preferred) or `purge_everything: true`.',
  pagesList:        'List Cloudflare Pages projects on the account.',
  pagesDeployments: 'List recent deployments for a Pages project.',
  pagesRemove:      'Delete a Cloudflare Pages project. Irreversible — removes all deployments and releases the *.pages.dev subdomain.',
  pagesDeploy:      'Deploy a local directory to Cloudflare Pages. Creates the project on first use. `dir` is relative to /work and must contain the built site (e.g. "site/dist").',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: CloudflareCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CloudflareCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('whoami',           DESC.whoami,           whoamiArgs.shape,           async (a, x) => asText(await handleWhoami(tu(x), a))),
    sdkTool('purgeCache',       DESC.purgeCache,       purgeCacheArgs.shape,       async (a, x) => asText(await handlePurgeCache(tu(x), a))),
    sdkTool('pagesList',        DESC.pagesList,        pagesListArgs.shape,        async (a, x) => asText(await handlePagesList(tu(x), a))),
    sdkTool('pagesDeployments', DESC.pagesDeployments, pagesDeploymentsArgs.shape, async (a, x) => asText(await handlePagesDeployments(tu(x), a))),
    sdkTool('pagesRemove',      DESC.pagesRemove,      pagesRemoveArgs.shape,      async (a, x) => asText(await handlePagesRemove(tu(x), a))),
    sdkTool('pagesDeploy',      DESC.pagesDeploy,      pagesDeployArgs.shape,      async (a, x) => asText(await handlePagesDeploy(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `cloudflare:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

// ── Vercel ai SDK adapter ──

export function buildAi(ctx: CloudflareCtx) {
  const prefix = `cloudflare-${ctx.connectionName}`
  return {
    [`${prefix}-whoami`]: tool({
      description: DESC.whoami,           inputSchema: whoamiArgs,
      execute:     (a: z.infer<typeof whoamiArgs>) => handleWhoami(ctx, a),
    }),
    [`${prefix}-purgeCache`]: tool({
      description: DESC.purgeCache,       inputSchema: purgeCacheArgs,
      execute:     (a: z.infer<typeof purgeCacheArgs>) => handlePurgeCache(ctx, a),
    }),
    [`${prefix}-pagesList`]: tool({
      description: DESC.pagesList,        inputSchema: pagesListArgs,
      execute:     (a: z.infer<typeof pagesListArgs>) => handlePagesList(ctx, a),
    }),
    [`${prefix}-pagesDeployments`]: tool({
      description: DESC.pagesDeployments, inputSchema: pagesDeploymentsArgs,
      execute:     (a: z.infer<typeof pagesDeploymentsArgs>) => handlePagesDeployments(ctx, a),
    }),
    [`${prefix}-pagesRemove`]: tool({
      description: DESC.pagesRemove,      inputSchema: pagesRemoveArgs,
      execute:     (a: z.infer<typeof pagesRemoveArgs>) => handlePagesRemove(ctx, a),
    }),
    [`${prefix}-pagesDeploy`]: tool({
      description: DESC.pagesDeploy,      inputSchema: pagesDeployArgs,
      execute:     (a: z.infer<typeof pagesDeployArgs>) => handlePagesDeploy(ctx, a),
    }),
  }
}
