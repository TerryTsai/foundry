import { z } from 'zod'
import type { ConnectionProvider, ConnectionToolCtx, ToolRunSpec } from './provider.js'

// ════════════════════════════════════════════════════════════════════════════
// CLOUDFLARE PROVIDER
// ════════════════════════════════════════════════════════════════════════════
// Non-model integration: exposes Cloudflare REST API tools to agents.
// Uses a scoped API token (preferred over legacy global API key).
//
// Token needs, at minimum:
//   - Zone:Read + DNS:Read for listing zones / DNS records
//   - Cache Purge:Purge for purgeCache
//   - Workers Scripts:Read + Pages:Read for listing
//   - Pages:Edit for deploy
// Create tokens at https://dash.cloudflare.com/profile/api-tokens.
//
// All tools run through runCommand → podman sandbox → execution row.
// Secrets are passed via env only, never serialized onto the row.

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

// Require accountId from config unless the tool args carry an override.
function resolveAccountId(ctx: ConnectionToolCtx, override?: string): string {
  const fromArgs = override?.trim()
  if (fromArgs) return fromArgs
  const fromCfg  = typeof ctx.config.account_id === 'string' ? ctx.config.account_id.trim() : ''
  if (fromCfg) return fromCfg
  throw new Error('account_id required — set on the connection or pass as an argument')
}

export const cloudflare: ConnectionProvider = {
  kind: 'cloudflare',
  name: 'Cloudflare',
  credentials: [
    {
      key: 'api_token',  label: 'API Token', type: 'password',
      placeholder: 'cloudflare API token (scoped, not the global key)',
      help: 'Create one at dash.cloudflare.com/profile/api-tokens with the permissions you want the agent to have.',
    },
    {
      key: 'account_id', label: 'Account ID', type: 'text', required: false,
      help: 'Default account scope for tools that need it. Optional; tools can override per-call.',
    },
  ],

  tools: [

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
    // all deployments and the *.pages.dev subdomain go with it. No
    // confirmation prompt because the agent wrapper can gate this at
    // the call-site (e.g. human approval on destructive ops).
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
    // Creates the project if it doesn't exist, hashes + uploads the
    // files, and publishes a deployment. Shells out to wrangler (baked
    // into the sandbox image) so we don't have to re-implement the
    // 7-step upload protocol ourselves.
    //
    // Workspace mounts 'ro' — the command only reads the built assets.
    // CF token + account id ride in env; dir is passed as an arg.
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
        // Isolated model: the requested dir is copied into /input/dist
        // before the container starts. /work is NOT mounted — this
        // credential-holding call can see only the built assets, nothing
        // else in the workspace. Wrangler's cache lives in the ephemeral
        // container FS (cwd=/tmp) and dies with the container.
        // Wrangler's `pages deploy` does NOT auto-create missing projects
        // in non-interactive mode — it just errors with "project not found".
        // Run `project create` first; if the project already exists, that
        // command exits non-zero but we ignore it (idempotent create).
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
      // Wrangler prints a line like: "✨ Deployment complete! Take a peek over at https://<hash>.<project>.pages.dev"
      // Surface both the per-deploy URL and the stable project URL so the
      // agent can comment them cleanly without re-parsing.
      parse: r => {
        if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
        const out = r.stdout
        const deployMatch = out.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev/i)
        const deployUrl  = deployMatch?.[0] ?? null
        const projectUrl = deployUrl ? deployUrl.replace(/^https:\/\/[a-z0-9]+\./i, 'https://') : null
        return { ok: true, deployUrl, projectUrl, stdout: out }
      },
    },

  ],

  validate: (secrets, _config) => {
    const token = typeof secrets.api_token === 'string' ? secrets.api_token.trim() : ''
    if (!token) return 'api_token is required'
    // Cloudflare tokens are opaque; no format check beyond non-empty.
    return null
  },
}
