// Cal.com v1 — scheduling. Auth is the API key on the `?apiKey=` query
// string (not a header).

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'calcom',
  name:        'Cal.com',
  category:    'growth',
  description: 'Scheduling, event types, and bookings.',
  tools: [
    { name: 'bookingList',   description: 'List bookings, optionally filtered.' },
    { name: 'bookingGet',    description: 'Fetch one booking.' },
    { name: 'bookingCancel', description: 'Cancel a booking.' },
    { name: 'eventTypeList', description: 'List event types.' },
    { name: 'ping',          description: 'Verify the API key.' },
  ],
}

type CalcomCtx = ConnCtx

const bookingListArgs = z.object({
  status: z.enum(['upcoming', 'recurring', 'past', 'cancelled', 'unconfirmed']).optional(),
  take:   z.number().int().min(1).max(100).optional(),
  skip:   z.number().int().min(0).optional(),
})
const bookingIdArgs = z.object({
  id: z.number().int().describe('Booking id.'),
})
const bookingCancelArgs = z.object({
  id:     z.number().int().describe('Booking id.'),
  reason: z.string().optional().describe('Cancellation reason.'),
})
const eventTypeListArgs = z.object({})
const pingArgs          = z.object({})

async function api(ctx: CalcomCtx, toolName: string, args: unknown, method: 'GET' | 'POST' | 'DELETE', path: string, extraQuery?: Record<string, string>, body?: unknown) {
  const qs = new URLSearchParams(extraQuery)
  // Build the URL shell — apiKey is appended at exec time from env.
  const base = `https://api.cal.com/v1${path}`
  const sep1 = base.includes('?') ? '&' : '?'
  const sep2 = qs.toString() ? '&' : ''
  const url = `${base}${sep1}apiKey=$KEY${sep2}${qs.toString()}`
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} "${url}"${bodyFlag}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, toolName, args, {
      network: true, mount: 'none',
      env: { KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try { return { ok: true as const, result: JSON.parse(r.stdout) } }
  catch { return { ok: true as const, stdout: r.stdout } }
}

async function handleBookingList(ctx: CalcomCtx, args: z.infer<typeof bookingListArgs>) {
  const q: Record<string, string> = {}
  if (args.status)             q.status = args.status
  if (args.take !== undefined) q.take   = String(args.take)
  if (args.skip !== undefined) q.skip   = String(args.skip)
  return api(ctx, 'bookingList', args, 'GET', '/bookings', q)
}

async function handleBookingGet(ctx: CalcomCtx, args: z.infer<typeof bookingIdArgs>) {
  return api(ctx, 'bookingGet', args, 'GET', `/bookings/${args.id}`)
}

async function handleBookingCancel(ctx: CalcomCtx, args: z.infer<typeof bookingCancelArgs>) {
  return api(ctx, 'bookingCancel', args, 'DELETE', `/bookings/${args.id}/cancel`,
    args.reason ? { cancellationReason: args.reason } : undefined)
}

async function handleEventTypeList(ctx: CalcomCtx, args: z.infer<typeof eventTypeListArgs>) {
  return api(ctx, 'eventTypeList', args, 'GET', '/event-types')
}

async function handlePing(ctx: CalcomCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', '/me')
}

const DESC = {
  bookingList:   'List bookings. `status` is one of upcoming/recurring/past/cancelled/unconfirmed.',
  bookingGet:    'Fetch full details for one booking.',
  bookingCancel: 'Cancel a booking. `reason` is surfaced in the email to attendees.',
  eventTypeList: 'List all configured event types (meeting templates).',
  ping:          'Verify the API key by fetching the authenticated user.',
}

export function buildSdk(ctx: CalcomCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): CalcomCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('bookingList',   DESC.bookingList,   bookingListArgs.shape,   async (a, x) => asText(await handleBookingList(tu(x), a))),
    sdkTool('bookingGet',    DESC.bookingGet,    bookingIdArgs.shape,     async (a, x) => asText(await handleBookingGet(tu(x), a))),
    sdkTool('bookingCancel', DESC.bookingCancel, bookingCancelArgs.shape, async (a, x) => asText(await handleBookingCancel(tu(x), a))),
    sdkTool('eventTypeList', DESC.eventTypeList, eventTypeListArgs.shape, async (a, x) => asText(await handleEventTypeList(tu(x), a))),
    sdkTool('ping',          DESC.ping,          pingArgs.shape,          async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `calcom:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: CalcomCtx) {
  const p = `calcom-${ctx.connectionName}`
  return {
    [`${p}-bookingList`]:   tool({ description: DESC.bookingList,   inputSchema: bookingListArgs,   execute: a => handleBookingList(ctx, a) }),
    [`${p}-bookingGet`]:    tool({ description: DESC.bookingGet,    inputSchema: bookingIdArgs,     execute: a => handleBookingGet(ctx, a) }),
    [`${p}-bookingCancel`]: tool({ description: DESC.bookingCancel, inputSchema: bookingCancelArgs, execute: a => handleBookingCancel(ctx, a) }),
    [`${p}-eventTypeList`]: tool({ description: DESC.eventTypeList, inputSchema: eventTypeListArgs, execute: a => handleEventTypeList(ctx, a) }),
    [`${p}-ping`]:          tool({ description: DESC.ping,          inputSchema: pingArgs,          execute: a => handlePing(ctx, a) }),
  }
}
