// Cal.com v1 — scheduling. Auth is the API key on the `?apiKey=` query
// string (not a header).

import { z } from 'zod'

import { runCommand, type ConnCtx } from '../shared.js'
import type { McpServerInfo, ToolDef } from '../types.js'

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
  const base = `https://api.cal.com/v1${path}`
  const sep1 = base.includes('?') ? '&' : '?'
  const sep2 = qs.toString() ? '&' : ''
  const url = `${base}${sep1}apiKey=$API_KEY${sep2}${qs.toString()}`
  const bodyFlag = body !== undefined
    ? ` -H "Content-Type: application/json" --data ${JSON.stringify(JSON.stringify(body))}`
    : ''
  const cmd = `curl -sf -X ${method} "${url}"${bodyFlag}`
  const r = await runCommand(ctx,
    cmd, toolName, args, {
      env:       { API_KEY: ctx.secrets.api_key ?? '' },
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

// ── Tools ──

export const info: McpServerInfo = {
  id:          'calcom',
  name:        'Cal.com',
  category:    'growth',
  description: 'Scheduling, event types, and bookings.',
}

export const tools: ToolDef<ConnCtx>[] = [
  { name: 'bookingList',   description: 'List bookings. `status` is one of upcoming/recurring/past/cancelled/unconfirmed.',             schema: bookingListArgs,   handler: handleBookingList },
  { name: 'bookingGet',    description: 'Fetch full details for one booking.',                                                          schema: bookingIdArgs,     handler: handleBookingGet },
  { name: 'bookingCancel', description: 'Cancel a booking. `reason` is surfaced in the email to attendees.',                            schema: bookingCancelArgs, handler: handleBookingCancel },
  { name: 'eventTypeList', description: 'List all configured event types (meeting templates).',                                         schema: eventTypeListArgs, handler: handleEventTypeList },
  { name: 'ping',          description: 'Verify the API key by fetching the authenticated user.',                                       schema: pingArgs,          handler: handlePing },
]
