import { z } from 'zod'

import type { ConnectionToolCtx, ConnectionToolDef, ToolRunSpec } from '../../connections/types.js'

// Cloudflare MCP tools. Credentials come from the connection row via ctx.
// Every tool resolves to a ToolRunSpec that the connection server adapter
// runs inside a podman sandbox (same contract as every other MCP tool).

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

function runSpec(ctx: ConnectionToolCtx, command: string): ToolRunSpec {
  return {
    command,
    env:     { CF_TOKEN: ctx.secrets.api_token ?? '' },
    network: true,
    mount:   'none',
  }
}

// Cloudflare's API always wraps responses as { success, errors, messages, result }.
// Unwrap to just `result` on success; surface errors cleanly.
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

function resolveAccountId(ctx: ConnectionToolCtx, override?: string): string {
  const fromArgs = override?.trim()
  if (fromArgs) return fromArgs
  const fromCfg  = typeof ctx.config.account_id === 'string' ? ctx.config.account_id.trim() : ''
  if (fromCfg) return fromCfg
  throw new Error('account_id required — set on the connection or pass as an argument')
}

export const tools: ConnectionToolDef[] = [

  // ── whoami ──────────────────────────────────────────────────────────
  {
    name: 'whoami',
    description: 'Verify the token and show the authorized user / account context.',
    parameters: z.object({}),
    run: (_args, ctx) => runSpec(ctx, curl('GET', '/user/tokens/verify')),
    parse: r => r.exitCode !== 0
      ? { ok: false, error: r.stderr || r.stdout || 'request failed' }
      : { ok: true, result: parseCfResponse(r.stdout) },
  },

  // ── purgeCache ──────────────────────────────────────────────────────
  {
    name: 'purgeCache',
    description: 'Purge cache for a zone. Either a URL list (preferred) or everything.',
    parameters: z.object({
      zone_id:      z.string().describe('Zone id (get via zonesList).'),
      files:        z.array(z.string()).optional().describe('URLs to purge. Omit with purge_everything=true.'),
      purge_everything: z.boolean().optional().describe('Purge all cache in the zone.'),
    }),
    run: (args, ctx) => {
      const a = args as { zone_id: string; files?: string[]; purge_everything?: boolean }
      const body = a.purge_everything ? { purge_everything: true } : { files: a.files ?? [] }
      return runSpec(ctx, curl('POST', `/zones/${encodeURIComponent(a.zone_id)}/purge_cache`, body))
    },
    parse: r => r.exitCode !== 0
      ? { ok: false, error: r.stderr || r.stdout }
      : { ok: true, result: parseCfResponse(r.stdout) },
  },

  // ── pagesList ───────────────────────────────────────────────────────
  {
    name: 'pagesList',
    description: 'List Cloudflare Pages projects on the account.',
    parameters: z.object({
      account_id: z.string().optional(),
    }),
    run: (args, ctx) => {
      const acct = resolveAccountId(ctx, (args as { account_id?: string }).account_id)
      return runSpec(ctx, curl('GET', `/accounts/${encodeURIComponent(acct)}/pages/projects`))
    },
    parse: r => r.exitCode !== 0
      ? { ok: false, error: r.stderr || r.stdout }
      : { ok: true, projects: parseCfResponse(r.stdout) },
  },

  // ── pagesDeployments ────────────────────────────────────────────────
  {
    name: 'pagesDeployments',
    description: 'List recent deployments for a Pages project.',
    parameters: z.object({
      project_name: z.string().describe('Pages project name (slug).'),
      account_id:   z.string().optional(),
    }),
    run: (args, ctx) => {
      const a = args as { project_name: string; account_id?: string }
      const acct = resolveAccountId(ctx, a.account_id)
      return runSpec(ctx, curl('GET', `/accounts/${encodeURIComponent(acct)}/pages/projects/${encodeURIComponent(a.project_name)}/deployments`))
    },
    parse: r => r.exitCode !== 0
      ? { ok: false, error: r.stderr || r.stdout }
      : { ok: true, deployments: parseCfResponse(r.stdout) },
  },

  // ── pagesRemove ─────────────────────────────────────────────────────
  // Deletes a Cloudflare Pages project. Destructive and irreversible —
  // all deployments and the *.pages.dev subdomain go with it.
  {
    name: 'pagesRemove',
    description: 'Delete a Cloudflare Pages project. Irreversible — removes all deployments and releases the *.pages.dev subdomain.',
    parameters: z.object({
      project_name: z.string().describe('Pages project name (slug) to delete.'),
      account_id:   z.string().optional(),
    }),
    run: (args, ctx) => {
      const a = args as { project_name: string; account_id?: string }
      const acct = resolveAccountId(ctx, a.account_id)
      return runSpec(ctx, curl('DELETE', `/accounts/${encodeURIComponent(acct)}/pages/projects/${encodeURIComponent(a.project_name)}`))
    },
    parse: r => r.exitCode !== 0
      ? { ok: false, error: r.stderr || r.stdout }
      : { ok: true, result: parseCfResponse(r.stdout) },
  },

  // ── pagesDeploy ─────────────────────────────────────────────────────
  // Direct-upload deploy of a local directory to Cloudflare Pages.
  // Shells out to wrangler (baked into the sandbox image). Isolated
  // workspace: /work not mounted, dir copied into /input/dist.
  {
    name: 'pagesDeploy',
    description: 'Deploy a local directory to Cloudflare Pages. Creates the project on first use. Path is relative to /work.',
    parameters: z.object({
      project_name: z.string().describe('Pages project name (slug). Created if missing.'),
      dir:          z.string().describe('Directory to deploy, relative to /work. Must contain the built site (e.g. "site/dist").'),
      branch:       z.string().optional().describe('Deploy branch; default "main".'),
      account_id:   z.string().optional(),
    }),
    run: (args, ctx) => {
      const a = args as { project_name: string; dir: string; branch?: string; account_id?: string }
      const acct = resolveAccountId(ctx, a.account_id)
      const branch = a.branch ?? 'main'
      const cmd = [
        'wrangler pages project create',
        JSON.stringify(a.project_name),
        '--production-branch', JSON.stringify(branch),
        '2>/dev/null || true',
        '&&',
        'wrangler pages deploy /input/dist',
        '--project-name', JSON.stringify(a.project_name),
        '--branch',       JSON.stringify(branch),
        '--commit-dirty=true',
      ].join(' ')
      return {
        command: cmd,
        env: {
          CLOUDFLARE_API_TOKEN:  ctx.secrets.api_token ?? '',
          CLOUDFLARE_ACCOUNT_ID: acct,
        },
        network:     true,
        artifactsIn: [{ src: a.dir, dest: 'dist' }],
      }
    },
    parse: r => {
      if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
      const out = r.stdout
      const deployMatch = out.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev/i)
      const deployUrl  = deployMatch?.[0] ?? null
      const projectUrl = deployUrl ? deployUrl.replace(/^https:\/\/[a-z0-9]+\./i, 'https://') : null
      return { ok: true, deployUrl, projectUrl, stdout: out }
    },
  },

]
