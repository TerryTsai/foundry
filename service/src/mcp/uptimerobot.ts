// UptimeRobot v2 — HTTP/ping monitors. Every endpoint is POST with form
// data (api_key in the body, not a header). No typical REST semantics.

import { z } from 'zod'

import { runCommand, type ConnCtx } from './shared.js'
import type { McpServerInfo, ToolDef } from './registry.js'

export const info: McpServerInfo = {
  id:          'uptimerobot',
  name:        'UptimeRobot',
  category:    'product',
  description: 'HTTP / ping uptime monitors.',
  tools: [
    { name: 'monitorList',   description: 'List monitors, optionally filtered.' },
    { name: 'monitorCreate', description: 'Create a new monitor.' },
    { name: 'monitorPause',  description: 'Pause a monitor (status=0).' },
    { name: 'monitorResume', description: 'Resume a paused monitor (status=1).' },
    { name: 'monitorDelete', description: 'Delete a monitor.' },
    { name: 'ping',          description: 'Verify the API key.' },
  ],
}

type UptimeCtx = ConnCtx

const monitorListArgs = z.object({
  monitors: z.string().optional().describe('Comma-separated monitor ids to fetch specific ones.'),
  limit:    z.number().int().min(1).max(50).optional(),
  offset:   z.number().int().min(0).optional(),
})
const monitorCreateArgs = z.object({
  friendly_name: z.string(),
  url:           z.string().describe('URL or host to monitor.'),
  type:          z.enum(['http', 'keyword', 'ping', 'port', 'heartbeat']).default('http'),
  interval:      z.number().int().min(60).optional().describe('Seconds between checks. Default 300.'),
  keyword_type:  z.enum(['exists', 'not_exists']).optional(),
  keyword_value: z.string().optional(),
})
const monitorIdArgs = z.object({
  id: z.number().int().describe('Monitor id.'),
})
const pingArgs = z.object({})

const TYPE_CODE: Record<string, number> = { http: 1, keyword: 2, ping: 3, port: 4, heartbeat: 5 }

async function api(ctx: UptimeCtx, toolName: string, args: unknown, path: string, fields: Record<string, string | number>) {
  const parts = Object.entries({ format: 'json', ...fields })
    .map(([k, v]) => `--data-urlencode ${JSON.stringify(`${k}=${v}`)}`)
  const cmd = `curl -sf -X POST --data-urlencode "api_key=$KEY" ${parts.join(' ')} "https://api.uptimerobot.com/v2${path}"`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try {
    const parsed = JSON.parse(r.stdout) as { stat?: string; error?: unknown }
    if (parsed.stat === 'fail') return { ok: false as const, error: JSON.stringify(parsed.error) }
    return { ok: true as const, result: parsed }
  } catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleMonitorList(ctx: UptimeCtx, args: z.infer<typeof monitorListArgs>) {
  const fields: Record<string, string | number> = {}
  if (args.monitors)            fields.monitors = args.monitors
  if (args.limit !== undefined) fields.limit    = args.limit
  if (args.offset !== undefined) fields.offset  = args.offset
  return api(ctx, 'monitorList', args, '/getMonitors', fields)
}

async function handleMonitorCreate(ctx: UptimeCtx, args: z.infer<typeof monitorCreateArgs>) {
  const fields: Record<string, string | number> = {
    friendly_name: args.friendly_name,
    url:           args.url,
    type:          TYPE_CODE[args.type] ?? 1,
  }
  if (args.interval !== undefined) fields.interval = args.interval
  if (args.keyword_type)           fields.keyword_type  = args.keyword_type === 'exists' ? 1 : 2
  if (args.keyword_value)          fields.keyword_value = args.keyword_value
  return api(ctx, 'monitorCreate', args, '/newMonitor', fields)
}

async function handleMonitorPause(ctx: UptimeCtx, args: z.infer<typeof monitorIdArgs>) {
  return api(ctx, 'monitorPause', args, '/editMonitor', { id: args.id, status: 0 })
}

async function handleMonitorResume(ctx: UptimeCtx, args: z.infer<typeof monitorIdArgs>) {
  return api(ctx, 'monitorResume', args, '/editMonitor', { id: args.id, status: 1 })
}

async function handleMonitorDelete(ctx: UptimeCtx, args: z.infer<typeof monitorIdArgs>) {
  return api(ctx, 'monitorDelete', args, '/deleteMonitor', { id: args.id })
}

async function handlePing(ctx: UptimeCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, '/getAccountDetails', {})
}

// ── Tools ──

export const tools: ToolDef[] = [
  { name: 'monitorList',   description: 'List monitors. `monitors` optionally narrows to specific ids (comma-separated).',                                                                                   schema: monitorListArgs,   handler: handleMonitorList },
  { name: 'monitorCreate', description: 'Create a monitor. `type` is one of http/keyword/ping/port/heartbeat. For keyword monitors pass `keyword_type` ("exists"/"not_exists") and `keyword_value`.',        schema: monitorCreateArgs, handler: handleMonitorCreate },
  { name: 'monitorPause',  description: 'Pause a monitor without deleting it.',                                                                                                                              schema: monitorIdArgs,     handler: handleMonitorPause },
  { name: 'monitorResume', description: 'Resume a paused monitor.',                                                                                                                                          schema: monitorIdArgs,     handler: handleMonitorResume },
  { name: 'monitorDelete', description: 'Permanently delete a monitor.',                                                                                                                                     schema: monitorIdArgs,     handler: handleMonitorDelete },
  { name: 'ping',          description: 'Verify the API key by fetching account details.',                                                                                                                   schema: pingArgs,          handler: handlePing },
]
