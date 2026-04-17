// Clerk — user auth. Secret key authenticates server-side user CRUD.

import { z } from 'zod'

import { runCommand, type ConnCtx } from './shared.js'
import type { McpServerInfo, ToolDef } from './registry.js'

export const info: McpServerInfo = {
  id:          'clerk',
  name:        'Clerk',
  category:    'growth',
  description: 'User auth (sessions, profiles, orgs).',
}

type ClerkCtx = ConnCtx

const userListArgs = z.object({
  query:   z.string().optional().describe('Search by name, email, or username.'),
  limit:   z.number().int().min(1).max(500).optional(),
  offset:  z.number().int().min(0).optional(),
})
const userGetArgs = z.object({
  id: z.string().describe('User id (user_…).'),
})
const userUpdateArgs = z.object({
  id: z.string().describe('User id.'),
  first_name:          z.string().optional(),
  last_name:           z.string().optional(),
  public_metadata:     z.record(z.string(), z.unknown()).optional(),
  private_metadata:    z.record(z.string(), z.unknown()).optional(),
  unsafe_metadata:     z.record(z.string(), z.unknown()).optional(),
})
const userBanArgs   = z.object({ id: z.string() })
const userUnbanArgs = z.object({ id: z.string() })
const pingArgs      = z.object({})

async function api(ctx: ClerkCtx, toolName: string, args: unknown, method: 'GET' | 'PATCH' | 'POST', path: string, body?: unknown) {
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} -H "Authorization: Bearer $KEY" "https://api.clerk.com/v1${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.secret_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleUserList(ctx: ClerkCtx, args: z.infer<typeof userListArgs>) {
  const qs = new URLSearchParams()
  if (args.query)               qs.set('query',  args.query)
  if (args.limit !== undefined) qs.set('limit',  String(args.limit))
  if (args.offset !== undefined) qs.set('offset', String(args.offset))
  const q = qs.toString()
  return api(ctx, 'userList', args, 'GET', `/users${q ? `?${q}` : ''}`)
}

async function handleUserGet(ctx: ClerkCtx, args: z.infer<typeof userGetArgs>) {
  return api(ctx, 'userGet', args, 'GET', `/users/${encodeURIComponent(args.id)}`)
}

async function handleUserUpdate(ctx: ClerkCtx, args: z.infer<typeof userUpdateArgs>) {
  const { id, ...patch } = args
  return api(ctx, 'userUpdate', args, 'PATCH', `/users/${encodeURIComponent(id)}`, patch)
}

async function handleUserBan(ctx: ClerkCtx, args: z.infer<typeof userBanArgs>) {
  return api(ctx, 'userBan', args, 'POST', `/users/${encodeURIComponent(args.id)}/ban`)
}

async function handleUserUnban(ctx: ClerkCtx, args: z.infer<typeof userUnbanArgs>) {
  return api(ctx, 'userUnban', args, 'POST', `/users/${encodeURIComponent(args.id)}/unban`)
}

async function handlePing(ctx: ClerkCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', '/users?limit=1')
}

// ── Tools ──

export const tools: ToolDef[] = [
  { name: 'userList',   description: 'List users. `query` searches name/email/username. Paginate with `offset` + `limit`.',                                                      schema: userListArgs,   handler: handleUserList },
  { name: 'userGet',    description: 'Fetch one user\'s full record (email addresses, external accounts, metadata).',                                                             schema: userGetArgs,    handler: handleUserGet },
  { name: 'userUpdate', description: 'Patch user fields. Only include fields you want to change. Use metadata maps for arbitrary app-specific state.',                            schema: userUpdateArgs, handler: handleUserUpdate },
  { name: 'userBan',    description: 'Prevent a user from signing in. Reversible via userUnban.',                                                                                 schema: userBanArgs,    handler: handleUserBan },
  { name: 'userUnban',  description: 'Restore sign-in access for a previously-banned user.',                                                                                      schema: userUnbanArgs,  handler: handleUserUnban },
  { name: 'ping',       description: 'Verify the secret key by fetching one user.',                                                                                              schema: pingArgs,       handler: handlePing },
]
