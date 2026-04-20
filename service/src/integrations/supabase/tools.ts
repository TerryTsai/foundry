// Supabase — REST access to Postgres via PostgREST. The service_role key
// bypasses RLS, which is what an agent acting on behalf of the founder
// needs. Filter syntax mirrors PostgREST: `column=op.value` pairs.

import { z } from 'zod'

import { runCommand, type ConnCtx } from '../shared.js'
import type { McpServerInfo, ToolDef } from '../types.js'

type SupabaseCtx = ConnCtx

function baseUrl(ctx: SupabaseCtx): string {
  return (ctx.secrets.project_url ?? '').replace(/\/+$/, '')
}

const filterSchema = z.record(z.string(), z.string()).optional()
  .describe('PostgREST filter map. Example: { status: "eq.active", age: "gt.18" }.')

const tableSelectArgs = z.object({
  table:  z.string().describe('Table name.'),
  select: z.string().optional().describe('Comma-separated columns. Default *.'),
  filter: filterSchema,
  order:  z.string().optional().describe('Order spec, e.g. "created_at.desc".'),
  limit:  z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
})
const tableInsertArgs = z.object({
  table: z.string(),
  rows:  z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
           .describe('A single row object or an array of rows.'),
  returning: z.boolean().optional().describe('Return inserted rows. Default true.'),
})
const tableUpdateArgs = z.object({
  table:  z.string(),
  filter: z.record(z.string(), z.string()).describe('Required. PostgREST filter map.'),
  patch:  z.record(z.string(), z.unknown()).describe('Column patch to apply.'),
})
const tableDeleteArgs = z.object({
  table:  z.string(),
  filter: z.record(z.string(), z.string()).describe('Required. PostgREST filter map.'),
})
const pingArgs = z.object({})

function buildQuery(filter?: Record<string, string>, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams()
  if (filter) for (const [k, v] of Object.entries(filter)) qs.set(k, v)
  for (const [k, v] of Object.entries(extra)) qs.set(k, v)
  const s = qs.toString()
  return s ? `?${s}` : ''
}

async function api(ctx: SupabaseCtx, toolName: string, args: unknown, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, prefer?: string) {
  const headers: string[] = [
    '-H "apikey: $SERVICE_ROLE_KEY"',
    '-H "Authorization: Bearer $SERVICE_ROLE_KEY"',
  ]
  if (body !== undefined) headers.push('-H "Content-Type: application/json"')
  if (prefer) headers.push(`-H "Prefer: ${prefer}"`)
  const bodyFlag = body !== undefined ? ` --data ${JSON.stringify(JSON.stringify(body))}` : ''
  const cmd = `curl -sf -X ${method} ${headers.join(' ')} "${baseUrl(ctx)}${path}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      env:       { SERVICE_ROLE_KEY: ctx.secrets.service_role_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  if (!r.stdout.trim()) return { ok: true as const }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleTableSelect(ctx: SupabaseCtx, args: z.infer<typeof tableSelectArgs>) {
  const extra: Record<string, string> = {}
  if (args.select)           extra.select = args.select
  if (args.order)            extra.order  = args.order
  if (args.limit !== undefined)  extra.limit  = String(args.limit)
  if (args.offset !== undefined) extra.offset = String(args.offset)
  return api(ctx, 'tableSelect', args, 'GET', `/rest/v1/${encodeURIComponent(args.table)}${buildQuery(args.filter, extra)}`)
}

async function handleTableInsert(ctx: SupabaseCtx, args: z.infer<typeof tableInsertArgs>) {
  const prefer = args.returning === false ? 'return=minimal' : 'return=representation'
  return api(ctx, 'tableInsert', args, 'POST', `/rest/v1/${encodeURIComponent(args.table)}`, args.rows, prefer)
}

async function handleTableUpdate(ctx: SupabaseCtx, args: z.infer<typeof tableUpdateArgs>) {
  return api(ctx, 'tableUpdate', args, 'PATCH',
    `/rest/v1/${encodeURIComponent(args.table)}${buildQuery(args.filter)}`,
    args.patch, 'return=representation')
}

async function handleTableDelete(ctx: SupabaseCtx, args: z.infer<typeof tableDeleteArgs>) {
  return api(ctx, 'tableDelete', args, 'DELETE',
    `/rest/v1/${encodeURIComponent(args.table)}${buildQuery(args.filter)}`,
    undefined, 'return=representation')
}

async function handlePing(ctx: SupabaseCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', '/rest/v1/')
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'supabase',
  name:        'Supabase',
  category:    'data',
  description: 'Postgres tables via PostgREST.',
}

export const tools: ToolDef[] = [
  { name: 'tableSelect', description: 'SELECT rows from a table. Filter syntax is PostgREST: { column: "op.value" } where op is one of eq, neq, gt, gte, lt, lte, like, ilike, in, is. `select` picks columns ("a,b,c"); `order` takes "column.asc" or "column.desc".', schema: tableSelectArgs, handler: handleTableSelect },
  { name: 'tableInsert', description: 'INSERT one row (object) or many (array). Returns the inserted rows with server-generated columns unless `returning:false`.',                                                                                                     schema: tableInsertArgs, handler: handleTableInsert },
  { name: 'tableUpdate', description: 'UPDATE rows matching `filter`. `filter` is required to prevent accidentally patching the whole table.',                                                                                                                          schema: tableUpdateArgs, handler: handleTableUpdate },
  { name: 'tableDelete', description: 'DELETE rows matching `filter`. `filter` is required.',                                                                                                                                                                           schema: tableDeleteArgs, handler: handleTableDelete },
  { name: 'ping',        description: 'Verify the project URL + service_role key by hitting the REST root.',                                                                                                                                                            schema: pingArgs,        handler: handlePing },
]
