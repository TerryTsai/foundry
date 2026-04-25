// Sentry — error tracking. Uses the org-scoped REST API; auth is a
// Bearer auth token. Supports listing, fetching, and resolving issues.

import { z } from 'zod'

import { runCommand, type ConnCtx } from '../shared.js'
import type { McpServerInfo, ToolDef } from '../types.js'

type SentryCtx = ConnCtx

function host(ctx: SentryCtx): string {
  const h = typeof ctx.connConfig.host === 'string' ? ctx.connConfig.host.trim() : ''
  return (h || 'https://sentry.io').replace(/\/+$/, '')
}
function org(ctx: SentryCtx): string {
  return ctx.secrets.organization ?? (typeof ctx.connConfig.organization === 'string' ? ctx.connConfig.organization : '')
}

const listIssuesArgs = z.object({
  project: z.string().describe('Project slug (e.g. "javascript-frontend").'),
  query:   z.string().optional().describe('Sentry search query (e.g. "is:unresolved").'),
  limit:   z.number().int().min(1).max(100).optional().describe('Default 25.'),
  cursor:  z.string().optional().describe('Pagination cursor from a prior call.'),
})
const getIssueArgs = z.object({
  id: z.string().describe('Issue id (numeric or short id).'),
})
const resolveIssueArgs = z.object({
  id: z.string().describe('Issue id to resolve.'),
})
const pingArgs = z.object({})

async function api(ctx: SentryCtx, toolName: string, args: unknown, method: 'GET' | 'PUT', path: string, body?: unknown) {
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} -H "Authorization: Bearer $AUTH_TOKEN" "${host(ctx)}${path}"${bodyFlag}`
  const r = await runCommand(ctx,
    cmd, toolName, args, {
      env:       { AUTH_TOKEN: ctx.secrets.auth_token ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleListIssues(ctx: SentryCtx, args: z.infer<typeof listIssuesArgs>) {
  const qs = new URLSearchParams()
  qs.set('limit', String(args.limit ?? 25))
  if (args.query)  qs.set('query',  args.query)
  if (args.cursor) qs.set('cursor', args.cursor)
  const path = `/api/0/projects/${encodeURIComponent(org(ctx))}/${encodeURIComponent(args.project)}/issues/?${qs}`
  return api(ctx, 'listIssues', args, 'GET', path)
}

async function handleGetIssue(ctx: SentryCtx, args: z.infer<typeof getIssueArgs>) {
  return api(ctx, 'getIssue', args, 'GET', `/api/0/issues/${encodeURIComponent(args.id)}/`)
}

async function handleResolveIssue(ctx: SentryCtx, args: z.infer<typeof resolveIssueArgs>) {
  return api(ctx, 'resolveIssue', args, 'PUT', `/api/0/issues/${encodeURIComponent(args.id)}/`, { status: 'resolved' })
}

async function handlePing(ctx: SentryCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', `/api/0/organizations/${encodeURIComponent(org(ctx))}/`)
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'sentry',
  name:        'Sentry',
  category:    'product',
  description: 'Error tracking.',
}

export const tools: ToolDef<ConnCtx>[] = [
  { name: 'listIssues',   description: 'List issues in a project. Use `query` with Sentry search syntax (e.g. "is:unresolved", "issue.category:error age:-24h"). Pagination: pass `cursor` from the prior response\'s Link header to fetch the next page.', schema: listIssuesArgs,   handler: handleListIssues },
  { name: 'getIssue',     description: 'Fetch full details for one issue.',                                                                                                                                                                                  schema: getIssueArgs,     handler: handleGetIssue },
  { name: 'resolveIssue', description: 'Mark an issue resolved. Useful for auto-triage after a fix deploy.',                                                                                                                                                 schema: resolveIssueArgs, handler: handleResolveIssue },
  { name: 'ping',         description: 'Verify the auth token + organization by fetching the organization.',                                                                                                                                                 schema: pingArgs,         handler: handlePing },
]
