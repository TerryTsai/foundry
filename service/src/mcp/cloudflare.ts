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
    { name: 'zonesList',        description: 'List DNS zones on the account.' },
    { name: 'purgeCache',       description: 'Purge cache for a zone. Either a URL list (preferred) or everything.' },
    { name: 'pagesList',        description: 'List Cloudflare Pages projects on the account.' },
    { name: 'pagesDeployments', description: 'List recent deployments for a Pages project.' },
    { name: 'pagesRemove',      description: 'Delete a Cloudflare Pages project. Irreversible.' },
    { name: 'pagesDeploy',      description: 'Deploy a local directory to Cloudflare Pages. Creates the project on first use.' },
    { name: 'r2CreateBucket',    description: 'Create a new R2 bucket.' },
    { name: 'r2DeleteBucket',   description: 'Delete an R2 bucket.' },
    { name: 'r2ListBuckets',    description: 'List R2 buckets on the account.' },
    { name: 'r2ListObjects',    description: 'List objects in an R2 bucket.' },
    { name: 'r2Upload',         description: 'Upload a workspace file to an R2 bucket.' },
    { name: 'r2Download',       description: 'Download an R2 object to the workspace.' },
    { name: 'r2Delete',         description: 'Delete an object from an R2 bucket.' },
    { name: 'd1Create',         description: 'Create a new D1 database.' },
    { name: 'd1Delete',         description: 'Delete a D1 database.' },
    { name: 'd1List',           description: 'List D1 databases on the account.' },
    { name: 'd1Query',          description: 'Execute a SQL statement on a D1 database.' },
    { name: 'kvCreate',         description: 'Create a new KV namespace.' },
    { name: 'kvDeleteNamespace', description: 'Delete a KV namespace entirely.' },
    { name: 'kvList',           description: 'List KV namespaces on the account.' },
    { name: 'kvGet',            description: 'Get a value from a KV namespace.' },
    { name: 'kvPut',            description: 'Set a value in a KV namespace.' },
    { name: 'kvDelete',         description: 'Delete a key from a KV namespace.' },
  ],
}

type CloudflareCtx = ConnCtx

// ── Schemas ──

const whoamiArgs           = z.object({})
const zonesListArgs        = z.object({ account_id: z.string().optional() })
const purgeCacheArgs       = z.object({
  zone_id:          z.string().describe('Zone id.'),
  files:            z.array(z.string()).optional().describe('URLs to purge. Mutually exclusive with purge_everything.'),
  purge_everything: z.boolean().optional().describe('Purge all cache. Mutually exclusive with files.'),
}).refine(d => !d.files || !d.purge_everything, 'Provide files OR purge_everything, not both')
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
  project_name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Project name must be lowercase alphanumeric with hyphens').describe('Pages project slug (lowercase, hyphens ok). Created if missing.'),
  dir:          z.string().describe('Static output directory relative to /work (e.g. "public", "dist"). Must contain at least one file (e.g. index.html). Server-side handlers go in /work/functions/ and are deployed automatically.'),
  branch:       z.string().optional().describe('Deploy branch; default "main".'),
  account_id:   z.string().optional(),
})
// ── R2 ──
const r2BucketName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Bucket name: 3-63 chars, lowercase letters/numbers/hyphens')

const r2CreateBucketArgs = z.object({
  bucket:     r2BucketName.describe('Bucket name to create (lowercase, 3-63 chars).'),
  account_id: z.string().optional(),
})
const r2DeleteBucketArgs = z.object({
  bucket:     z.string().describe('Bucket name to delete. Must be empty.'),
  account_id: z.string().optional(),
})
const r2ListBucketsArgs = z.object({ account_id: z.string().optional() })
const r2ListObjectsArgs = z.object({
  bucket:     z.string().describe('Bucket name.'),
  prefix:     z.string().optional().describe('Object prefix filter.'),
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
const d1CreateArgs = z.object({
  name:       z.string().describe('Database name.'),
  account_id: z.string().optional(),
})
const d1DeleteArgs = z.object({
  name:       z.string().describe('Database name to delete.'),
  account_id: z.string().optional(),
})
const d1ListArgs = z.object({ account_id: z.string().optional() })
const d1QueryArgs = z.object({
  database:   z.string().describe('D1 database name.'),
  sql:        z.string().describe('SQL statement to execute.'),
  account_id: z.string().optional(),
})
// ── KV ──
const kvDeleteNamespaceArgs = z.object({
  namespace_id: z.string().describe('KV namespace id to delete.'),
  account_id:   z.string().optional(),
})
const kvCreateArgs = z.object({
  title:      z.string().describe('KV namespace title.'),
  account_id: z.string().optional(),
})
const kvListArgs = z.object({ account_id: z.string().optional() })
const kvGetArgs = z.object({
  namespace_id: z.string().describe('KV namespace id.'),
  key:          z.string().describe('Key to read.'),
  account_id:   z.string().optional(),
})
const kvDeleteArgs = z.object({
  namespace_id: z.string().describe('KV namespace id.'),
  key:          z.string().describe('Key to delete.'),
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

async function handleZonesList(ctx: CloudflareCtx, args: z.infer<typeof zonesListArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const r = await runCf(ctx, 'zonesList', args, curl('GET', `/zones?account.id=${encodeURIComponent(acct)}`))
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, zones: parseCfResponse(r.stdout) }
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

// Deploy to Cloudflare Pages. /work is mounted rw so wrangler sees the
// full project tree (static assets, functions/, wrangler.toml). The
// `dir` arg is the path to the static output directory relative to /work.
async function handlePagesDeploy(ctx: CloudflareCtx, args: z.infer<typeof pagesDeployArgs>) {
  const acct = resolveAccountId(ctx, args.account_id)
  const branch = args.branch ?? 'main'
  const dir = `/work/${args.dir}`
  const command = [
    `if [ ! -d ${JSON.stringify(dir)} ]; then echo "ERR: directory ${args.dir} does not exist in /work" >&2; exit 1; fi`,
    `if [ -z "$(ls -A ${JSON.stringify(dir)} 2>/dev/null)" ]; then echo "ERR: directory ${args.dir} is empty — add at least an index.html" >&2; exit 1; fi`,
    `if [ -f /work/wrangler.toml ] && ! grep -q pages_build_output_dir /work/wrangler.toml; then echo 'pages_build_output_dir = "${args.dir}"' >> /work/wrangler.toml; fi`,
    `wrangler pages project create ${JSON.stringify(args.project_name)} --production-branch ${JSON.stringify(branch)} || true`,
    `wrangler pages deploy ${JSON.stringify(dir)} --project-name ${JSON.stringify(args.project_name)} --branch ${JSON.stringify(branch)} --commit-dirty=true`,
  ].join(' && ')
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'pagesDeploy', args, {
      network: true,
      mount:   'rw',
      env: {
        CLOUDFLARE_API_TOKEN:  ctx.secrets.api_token ?? '',
        CLOUDFLARE_ACCOUNT_ID: acct,
      },
      toolUseId: ctx.toolUseId,
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

async function handleR2CreateBucket(ctx: CloudflareCtx, args: z.infer<typeof r2CreateBucketArgs>) {
  return runWrangler(ctx, 'r2CreateBucket', args, `r2 bucket create ${JSON.stringify(args.bucket)}`)
}
async function handleR2DeleteBucket(ctx: CloudflareCtx, args: z.infer<typeof r2DeleteBucketArgs>) {
  return runWrangler(ctx, 'r2DeleteBucket', args, `r2 bucket delete ${JSON.stringify(args.bucket)}`)
}
async function handleR2ListBuckets(ctx: CloudflareCtx, args: z.infer<typeof r2ListBucketsArgs>) {
  return runWrangler(ctx, 'r2ListBuckets', args, 'r2 bucket list')
}
async function handleR2ListObjects(ctx: CloudflareCtx, args: z.infer<typeof r2ListObjectsArgs>) {
  const prefix = args.prefix ? ` --prefix ${JSON.stringify(args.prefix)}` : ''
  return runWrangler(ctx, 'r2ListObjects', args, `r2 object list ${JSON.stringify(args.bucket)}${prefix}`)
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
async function handleD1Create(ctx: CloudflareCtx, args: z.infer<typeof d1CreateArgs>) {
  return runWrangler(ctx, 'd1Create', args, `d1 create ${JSON.stringify(args.name)}`)
}
async function handleD1Delete(ctx: CloudflareCtx, args: z.infer<typeof d1DeleteArgs>) {
  return runWrangler(ctx, 'd1Delete', args, `d1 delete ${JSON.stringify(args.name)} -y`)
}
async function handleD1List(ctx: CloudflareCtx, args: z.infer<typeof d1ListArgs>) {
  return runWrangler(ctx, 'd1List', args, 'd1 list')
}
async function handleD1Query(ctx: CloudflareCtx, args: z.infer<typeof d1QueryArgs>) {
  return runWrangler(ctx, 'd1Query', args, `d1 execute ${JSON.stringify(args.database)} --remote --command ${JSON.stringify(args.sql)}`)
}
async function handleKvDeleteNamespace(ctx: CloudflareCtx, args: z.infer<typeof kvDeleteNamespaceArgs>) {
  return runWrangler(ctx, 'kvDeleteNamespace', args, `kv namespace delete --namespace-id=${JSON.stringify(args.namespace_id)}`)
}
async function handleKvCreate(ctx: CloudflareCtx, args: z.infer<typeof kvCreateArgs>) {
  const r: any = await runWrangler(ctx, 'kvCreate', args, `kv namespace create ${JSON.stringify(args.title)}`)
  if (!r.ok) return r
  const idMatch = (r.stdout ?? '').match(/id\s*=\s*"([^"]+)"/)
  return { ...r, namespace_id: idMatch?.[1] ?? null }
}
async function handleKvList(ctx: CloudflareCtx, args: z.infer<typeof kvListArgs>) {
  return runWrangler(ctx, 'kvList', args, 'kv namespace list')
}
async function handleKvGet(ctx: CloudflareCtx, args: z.infer<typeof kvGetArgs>) {
  return runWrangler(ctx, 'kvGet', args, `kv key get --namespace-id=${JSON.stringify(args.namespace_id)} ${JSON.stringify(args.key)}`)
}
async function handleKvDelete(ctx: CloudflareCtx, args: z.infer<typeof kvDeleteArgs>) {
  return runWrangler(ctx, 'kvDelete', args, `kv key delete --namespace-id=${JSON.stringify(args.namespace_id)} ${JSON.stringify(args.key)}`)
}
async function handleKvPut(ctx: CloudflareCtx, args: z.infer<typeof kvPutArgs>) {
  return runWrangler(ctx, 'kvPut', args, `kv key put --namespace-id=${JSON.stringify(args.namespace_id)} ${JSON.stringify(args.key)} ${JSON.stringify(args.value)}`)
}

const DESC = {
  whoami:           'Verify the token and show the authorized user / account context.',
  zonesList:        'List DNS zones on the account. Returns zone id, name, and status. Use the zone id for purgeCache.',
  purgeCache:       'Purge cache for a zone. Pass a `files` URL list (preferred) or `purge_everything: true`. Get the zone_id from zonesList first.',
  pagesList:        'List Cloudflare Pages projects on the account.',
  pagesDeployments: 'List recent deployments for a Pages project.',
  pagesRemove:      'Delete a Cloudflare Pages project. Irreversible — removes all deployments and releases the *.pages.dev subdomain.',
  pagesDeploy:      'Deploy to Cloudflare Pages. Creates the project on first use. `dir` is the static output directory relative to /work (e.g. "public"). If the project has a functions/ directory at /work/functions/, Pages Functions are deployed automatically alongside the static assets.',
  r2CreateBucket:   'Create a new R2 bucket on the account.',
  r2DeleteBucket:   'Delete an R2 bucket. The bucket must be empty.',
  r2ListBuckets:    'List R2 buckets on the account.',
  r2ListObjects:    'List objects in an R2 bucket with optional prefix filter.',
  r2Upload:         'Upload a workspace file to an R2 bucket. `file` is relative to /work.',
  r2Download:       'Download an R2 object to the workspace. `file` is relative to /work.',
  r2Delete:         'Delete an object from an R2 bucket.',
  d1Create:         'Create a new D1 SQLite database on the account.',
  d1Delete:         'Delete a D1 database. Irreversible — all data is lost.',
  d1List:           'List D1 databases on the account.',
  d1Query:          'Execute a SQL statement on a D1 database. Returns rows for SELECT, or change count for mutations.',
  kvCreate:         'Create a new KV namespace. Returns namespace_id — save it for kvGet/kvPut/kvDelete calls.',
  kvDeleteNamespace: 'Delete a KV namespace entirely. Irreversible — all keys are lost.',
  kvList:           'List KV namespaces on the account. Returns namespace ids and titles.',
  kvGet:            'Get a value from a KV namespace by key.',
  kvPut:            'Set a key-value pair in a KV namespace.',
  kvDelete:         'Delete a key from a KV namespace.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: CloudflareCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CloudflareCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('whoami',           DESC.whoami,           whoamiArgs.shape,           async (a, x) => asText(await handleWhoami(tu(x), a))),
    sdkTool('zonesList',        DESC.zonesList,        zonesListArgs.shape,        async (a, x) => asText(await handleZonesList(tu(x), a))),
    sdkTool('purgeCache',       DESC.purgeCache,       purgeCacheArgs.shape,       async (a, x) => asText(await handlePurgeCache(tu(x), a))),
    sdkTool('pagesList',        DESC.pagesList,        pagesListArgs.shape,        async (a, x) => asText(await handlePagesList(tu(x), a))),
    sdkTool('pagesDeployments', DESC.pagesDeployments, pagesDeploymentsArgs.shape, async (a, x) => asText(await handlePagesDeployments(tu(x), a))),
    sdkTool('pagesRemove',      DESC.pagesRemove,      pagesRemoveArgs.shape,      async (a, x) => asText(await handlePagesRemove(tu(x), a))),
    sdkTool('pagesDeploy',      DESC.pagesDeploy,      pagesDeployArgs.shape,      async (a, x) => asText(await handlePagesDeploy(tu(x), a))),
    sdkTool('r2CreateBucket',   DESC.r2CreateBucket,   r2CreateBucketArgs.shape,   async (a, x) => asText(await handleR2CreateBucket(tu(x), a))),
    sdkTool('r2DeleteBucket',   DESC.r2DeleteBucket,   r2DeleteBucketArgs.shape,   async (a, x) => asText(await handleR2DeleteBucket(tu(x), a))),
    sdkTool('r2ListBuckets',    DESC.r2ListBuckets,    r2ListBucketsArgs.shape,    async (a, x) => asText(await handleR2ListBuckets(tu(x), a))),
    sdkTool('r2ListObjects',    DESC.r2ListObjects,    r2ListObjectsArgs.shape,    async (a, x) => asText(await handleR2ListObjects(tu(x), a))),
    sdkTool('r2Upload',         DESC.r2Upload,         r2UploadArgs.shape,         async (a, x) => asText(await handleR2Upload(tu(x), a))),
    sdkTool('r2Download',       DESC.r2Download,       r2DownloadArgs.shape,       async (a, x) => asText(await handleR2Download(tu(x), a))),
    sdkTool('r2Delete',         DESC.r2Delete,         r2DeleteArgs.shape,         async (a, x) => asText(await handleR2Delete(tu(x), a))),
    sdkTool('d1Create',         DESC.d1Create,         d1CreateArgs.shape,         async (a, x) => asText(await handleD1Create(tu(x), a))),
    sdkTool('d1Delete',         DESC.d1Delete,         d1DeleteArgs.shape,         async (a, x) => asText(await handleD1Delete(tu(x), a))),
    sdkTool('d1List',           DESC.d1List,           d1ListArgs.shape,           async (a, x) => asText(await handleD1List(tu(x), a))),
    sdkTool('d1Query',          DESC.d1Query,          d1QueryArgs.shape,          async (a, x) => asText(await handleD1Query(tu(x), a))),
    sdkTool('kvDeleteNamespace', DESC.kvDeleteNamespace, kvDeleteNamespaceArgs.shape, async (a, x) => asText(await handleKvDeleteNamespace(tu(x), a))),
    sdkTool('kvCreate',         DESC.kvCreate,         kvCreateArgs.shape,         async (a, x) => asText(await handleKvCreate(tu(x), a))),
    sdkTool('kvList',           DESC.kvList,           kvListArgs.shape,           async (a, x) => asText(await handleKvList(tu(x), a))),
    sdkTool('kvGet',            DESC.kvGet,            kvGetArgs.shape,            async (a, x) => asText(await handleKvGet(tu(x), a))),
    sdkTool('kvPut',            DESC.kvPut,            kvPutArgs.shape,            async (a, x) => asText(await handleKvPut(tu(x), a))),
    sdkTool('kvDelete',         DESC.kvDelete,         kvDeleteArgs.shape,         async (a, x) => asText(await handleKvDelete(tu(x), a))),
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
    [`${prefix}-zonesList`]: tool({
      description: DESC.zonesList,        inputSchema: zonesListArgs,
      execute:     (a: z.infer<typeof zonesListArgs>) => handleZonesList(ctx, a),
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
    [`${prefix}-r2CreateBucket`]: tool({
      description: DESC.r2CreateBucket,   inputSchema: r2CreateBucketArgs,
      execute:     (a: z.infer<typeof r2CreateBucketArgs>) => handleR2CreateBucket(ctx, a),
    }),
    [`${prefix}-r2DeleteBucket`]: tool({
      description: DESC.r2DeleteBucket,   inputSchema: r2DeleteBucketArgs,
      execute:     (a: z.infer<typeof r2DeleteBucketArgs>) => handleR2DeleteBucket(ctx, a),
    }),
    [`${prefix}-r2ListBuckets`]: tool({
      description: DESC.r2ListBuckets,    inputSchema: r2ListBucketsArgs,
      execute:     (a: z.infer<typeof r2ListBucketsArgs>) => handleR2ListBuckets(ctx, a),
    }),
    [`${prefix}-r2ListObjects`]: tool({
      description: DESC.r2ListObjects,    inputSchema: r2ListObjectsArgs,
      execute:     (a: z.infer<typeof r2ListObjectsArgs>) => handleR2ListObjects(ctx, a),
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
    [`${prefix}-d1Create`]: tool({
      description: DESC.d1Create,         inputSchema: d1CreateArgs,
      execute:     (a: z.infer<typeof d1CreateArgs>) => handleD1Create(ctx, a),
    }),
    [`${prefix}-d1Delete`]: tool({
      description: DESC.d1Delete,         inputSchema: d1DeleteArgs,
      execute:     (a: z.infer<typeof d1DeleteArgs>) => handleD1Delete(ctx, a),
    }),
    [`${prefix}-d1List`]: tool({
      description: DESC.d1List,           inputSchema: d1ListArgs,
      execute:     (a: z.infer<typeof d1ListArgs>) => handleD1List(ctx, a),
    }),
    [`${prefix}-d1Query`]: tool({
      description: DESC.d1Query,          inputSchema: d1QueryArgs,
      execute:     (a: z.infer<typeof d1QueryArgs>) => handleD1Query(ctx, a),
    }),
    [`${prefix}-kvDeleteNamespace`]: tool({
      description: DESC.kvDeleteNamespace, inputSchema: kvDeleteNamespaceArgs,
      execute:     (a: z.infer<typeof kvDeleteNamespaceArgs>) => handleKvDeleteNamespace(ctx, a),
    }),
    [`${prefix}-kvCreate`]: tool({
      description: DESC.kvCreate,         inputSchema: kvCreateArgs,
      execute:     (a: z.infer<typeof kvCreateArgs>) => handleKvCreate(ctx, a),
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
    [`${prefix}-kvDelete`]: tool({
      description: DESC.kvDelete,         inputSchema: kvDeleteArgs,
      execute:     (a: z.infer<typeof kvDeleteArgs>) => handleKvDelete(ctx, a),
    }),
  }
}
