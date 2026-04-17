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
    { name: 'r2List',           description: 'List R2 buckets or objects within a bucket.' },
    { name: 'r2Upload',         description: 'Upload a workspace file to an R2 bucket.' },
    { name: 'r2Download',       description: 'Download an R2 object to the workspace.' },
    { name: 'r2Delete',         description: 'Delete an object from an R2 bucket.' },
    { name: 'd1List',           description: 'List D1 databases on the account.' },
    { name: 'd1Query',          description: 'Execute a SQL statement on a D1 database.' },
    { name: 'kvList',           description: 'List KV namespaces on the account.' },
    { name: 'kvGet',            description: 'Get a value from a KV namespace.' },
    { name: 'kvPut',            description: 'Set a value in a KV namespace.' },
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
// ── R2 ──
const r2ListArgs = z.object({
  bucket:     z.string().optional().describe('Bucket name. Omit to list buckets.'),
  prefix:     z.string().optional().describe('Object prefix filter (when listing objects in a bucket).'),
  account_id: z.string().optional(),
})
const r2UploadArgs = z.object({
  bucket:     z.string().describe('Bucket name.'),
  key:        z.string().describe('Object key (path in bucket).'),
  file:       z.string().describe('Workspace file path to upload (relative to /work).'),
  account_id: z.string().optional(),
})
const r2DownloadArgs = z.object({
  bucket:     z.string().describe('Bucket name.'),
  key:        z.string().describe('Object key.'),
  file:       z.string().describe('Workspace path to save to (relative to /work).'),
  account_id: z.string().optional(),
})
const r2DeleteArgs = z.object({
  bucket:     z.string().describe('Bucket name.'),
  key:        z.string().describe('Object key to delete.'),
  account_id: z.string().optional(),
})
// ── D1 ──
const d1ListArgs = z.object({ account_id: z.string().optional() })
const d1QueryArgs = z.object({
  database:   z.string().describe('D1 database name.'),
  sql:        z.string().describe('SQL statement to execute.'),
  account_id: z.string().optional(),
})
// ── KV ──
const kvListArgs = z.object({ account_id: z.string().optional() })
const kvGetArgs = z.object({
  namespace_id: z.string().describe('KV namespace id.'),
  key:          z.string().describe('Key to read.'),
  account_id:   z.string().optional(),
})
const kvPutArgs = z.object({
  namespace_id: z.string().describe('KV namespace id.'),
  key:          z.string().describe('Key to write.'),
  value:        z.string().describe('Value to store.'),
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

// Typed wrangler operations — each constructs a fixed command from typed
// args. /work is mounted rw so file paths resolve normally.
async function runWrangler(ctx: CloudflareCtx, toolName: string, args: unknown, command: string) {
  const acct = resolveAccountId(ctx, (args as { account_id?: string }).account_id)
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    `wrangler ${command}`, toolName, args, {
      network: true, mount: 'rw',
      env: { CLOUDFLARE_API_TOKEN: ctx.secrets.api_token ?? '', CLOUDFLARE_ACCOUNT_ID: acct },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

async function handleR2List(ctx: CloudflareCtx, args: z.infer<typeof r2ListArgs>) {
  const cmd = args.bucket
    ? `r2 object list ${JSON.stringify(args.bucket)}${args.prefix ? ` --prefix ${JSON.stringify(args.prefix)}` : ''}`
    : 'r2 bucket list'
  return runWrangler(ctx, 'r2List', args, cmd)
}
async function handleR2Upload(ctx: CloudflareCtx, args: z.infer<typeof r2UploadArgs>) {
  return runWrangler(ctx, 'r2Upload', args, `r2 object put ${JSON.stringify(args.bucket + '/' + args.key)} --file=${JSON.stringify('/work/' + args.file)}`)
}
async function handleR2Download(ctx: CloudflareCtx, args: z.infer<typeof r2DownloadArgs>) {
  return runWrangler(ctx, 'r2Download', args, `r2 object get ${JSON.stringify(args.bucket + '/' + args.key)} --file=${JSON.stringify('/work/' + args.file)}`)
}
async function handleR2Delete(ctx: CloudflareCtx, args: z.infer<typeof r2DeleteArgs>) {
  return runWrangler(ctx, 'r2Delete', args, `r2 object delete ${JSON.stringify(args.bucket + '/' + args.key)}`)
}
async function handleD1List(ctx: CloudflareCtx, args: z.infer<typeof d1ListArgs>) {
  return runWrangler(ctx, 'd1List', args, 'd1 list')
}
async function handleD1Query(ctx: CloudflareCtx, args: z.infer<typeof d1QueryArgs>) {
  return runWrangler(ctx, 'd1Query', args, `d1 execute ${JSON.stringify(args.database)} --command ${JSON.stringify(args.sql)}`)
}
async function handleKvList(ctx: CloudflareCtx, args: z.infer<typeof kvListArgs>) {
  return runWrangler(ctx, 'kvList', args, 'kv namespace list')
}
async function handleKvGet(ctx: CloudflareCtx, args: z.infer<typeof kvGetArgs>) {
  return runWrangler(ctx, 'kvGet', args, `kv key get --namespace-id=${JSON.stringify(args.namespace_id)} ${JSON.stringify(args.key)}`)
}
async function handleKvPut(ctx: CloudflareCtx, args: z.infer<typeof kvPutArgs>) {
  return runWrangler(ctx, 'kvPut', args, `kv key put --namespace-id=${JSON.stringify(args.namespace_id)} ${JSON.stringify(args.key)} ${JSON.stringify(args.value)}`)
}

const DESC = {
  whoami:           'Verify the token and show the authorized user / account context.',
  purgeCache:       'Purge cache for a zone. Pass a `files` URL list (preferred) or `purge_everything: true`.',
  pagesList:        'List Cloudflare Pages projects on the account.',
  pagesDeployments: 'List recent deployments for a Pages project.',
  pagesRemove:      'Delete a Cloudflare Pages project. Irreversible — removes all deployments and releases the *.pages.dev subdomain.',
  pagesDeploy:      'Deploy a local directory to Cloudflare Pages. Creates the project on first use. `dir` is relative to /work and must contain the built site (e.g. "site/dist").',
  r2List:           'List R2 buckets on the account, or list objects in a specific bucket (with optional prefix filter).',
  r2Upload:         'Upload a workspace file to an R2 bucket. `file` is relative to /work.',
  r2Download:       'Download an R2 object to the workspace. `file` is relative to /work.',
  r2Delete:         'Delete an object from an R2 bucket.',
  d1List:           'List D1 databases on the account.',
  d1Query:          'Execute a SQL statement on a D1 database. Returns rows for SELECT, or change count for mutations.',
  kvList:           'List KV namespaces on the account.',
  kvGet:            'Get a value from a KV namespace by key.',
  kvPut:            'Set a key-value pair in a KV namespace.',
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
    sdkTool('r2List',           DESC.r2List,           r2ListArgs.shape,           async (a, x) => asText(await handleR2List(tu(x), a))),
    sdkTool('r2Upload',         DESC.r2Upload,         r2UploadArgs.shape,         async (a, x) => asText(await handleR2Upload(tu(x), a))),
    sdkTool('r2Download',       DESC.r2Download,       r2DownloadArgs.shape,       async (a, x) => asText(await handleR2Download(tu(x), a))),
    sdkTool('r2Delete',         DESC.r2Delete,         r2DeleteArgs.shape,         async (a, x) => asText(await handleR2Delete(tu(x), a))),
    sdkTool('d1List',           DESC.d1List,           d1ListArgs.shape,           async (a, x) => asText(await handleD1List(tu(x), a))),
    sdkTool('d1Query',          DESC.d1Query,          d1QueryArgs.shape,          async (a, x) => asText(await handleD1Query(tu(x), a))),
    sdkTool('kvList',           DESC.kvList,           kvListArgs.shape,           async (a, x) => asText(await handleKvList(tu(x), a))),
    sdkTool('kvGet',            DESC.kvGet,            kvGetArgs.shape,            async (a, x) => asText(await handleKvGet(tu(x), a))),
    sdkTool('kvPut',            DESC.kvPut,            kvPutArgs.shape,            async (a, x) => asText(await handleKvPut(tu(x), a))),
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
    [`${prefix}-r2List`]: tool({
      description: DESC.r2List,           inputSchema: r2ListArgs,
      execute:     (a: z.infer<typeof r2ListArgs>) => handleR2List(ctx, a),
    }),
    [`${prefix}-r2Upload`]: tool({
      description: DESC.r2Upload,         inputSchema: r2UploadArgs,
      execute:     (a: z.infer<typeof r2UploadArgs>) => handleR2Upload(ctx, a),
    }),
    [`${prefix}-r2Download`]: tool({
      description: DESC.r2Download,       inputSchema: r2DownloadArgs,
      execute:     (a: z.infer<typeof r2DownloadArgs>) => handleR2Download(ctx, a),
    }),
    [`${prefix}-r2Delete`]: tool({
      description: DESC.r2Delete,         inputSchema: r2DeleteArgs,
      execute:     (a: z.infer<typeof r2DeleteArgs>) => handleR2Delete(ctx, a),
    }),
    [`${prefix}-d1List`]: tool({
      description: DESC.d1List,           inputSchema: d1ListArgs,
      execute:     (a: z.infer<typeof d1ListArgs>) => handleD1List(ctx, a),
    }),
    [`${prefix}-d1Query`]: tool({
      description: DESC.d1Query,          inputSchema: d1QueryArgs,
      execute:     (a: z.infer<typeof d1QueryArgs>) => handleD1Query(ctx, a),
    }),
    [`${prefix}-kvList`]: tool({
      description: DESC.kvList,           inputSchema: kvListArgs,
      execute:     (a: z.infer<typeof kvListArgs>) => handleKvList(ctx, a),
    }),
    [`${prefix}-kvGet`]: tool({
      description: DESC.kvGet,            inputSchema: kvGetArgs,
      execute:     (a: z.infer<typeof kvGetArgs>) => handleKvGet(ctx, a),
    }),
    [`${prefix}-kvPut`]: tool({
      description: DESC.kvPut,            inputSchema: kvPutArgs,
      execute:     (a: z.infer<typeof kvPutArgs>) => handleKvPut(ctx, a),
    }),
  }
}
