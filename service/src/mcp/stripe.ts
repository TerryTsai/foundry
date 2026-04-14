// Stripe — payments. HTTP Basic auth with the secret key as username,
// empty password. Requests use application/x-www-form-urlencoded
// (Stripe's house style, not JSON).

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'stripe',
  name:        'Stripe',
  category:    'growth',
  description: 'Payments, subscriptions, and checkout.',
  tools: [
    { name: 'customerList',     description: 'List customers.' },
    { name: 'customerGet',      description: 'Fetch one customer.' },
    { name: 'subscriptionList', description: 'List subscriptions, optionally filtered.' },
    { name: 'checkoutCreate',   description: 'Create a Checkout Session for a one-time or recurring payment.' },
    { name: 'ping',             description: 'Verify the secret key.' },
  ],
}

type StripeCtx = ConnCtx

const customerListArgs = z.object({
  email: z.string().optional().describe('Filter by exact email.'),
  limit: z.number().int().min(1).max(100).optional(),
  starting_after: z.string().optional().describe('Pagination cursor (customer id).'),
})
const customerGetArgs = z.object({
  id: z.string().describe('Customer id (cus_…).'),
})
const subscriptionListArgs = z.object({
  customer: z.string().optional().describe('Customer id (cus_…) to filter by.'),
  status:   z.enum(['all', 'active', 'past_due', 'canceled', 'trialing', 'unpaid']).optional(),
  limit:    z.number().int().min(1).max(100).optional(),
  starting_after: z.string().optional(),
})
const checkoutCreateArgs = z.object({
  mode:        z.enum(['payment', 'subscription', 'setup']).describe('"payment" one-time, "subscription" recurring, "setup" card-on-file.'),
  success_url: z.string().describe('Redirect target on success. Use {CHECKOUT_SESSION_ID} placeholder if you need the id.'),
  cancel_url:  z.string().describe('Redirect target on cancel.'),
  line_items:  z.array(z.object({
    price:    z.string().describe('Price id (price_…).'),
    quantity: z.number().int().min(1).optional(),
  })).describe('One or more line items referencing existing prices.'),
  customer: z.string().optional().describe('Existing customer id to attach to the session.'),
})
const pingArgs = z.object({})

// Flatten a nested object for Stripe's bracket-syntax form encoding.
// { a: 1, b: { c: 2 }, d: [{e: 3}] } → a=1, b[c]=2, d[0][e]=3.
function formFields(obj: unknown, prefix = ''): string[] {
  const out: string[] = []
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...formFields(item, `${k}[${i}]`)))
    else if (typeof v === 'object') out.push(...formFields(v, k))
    else out.push(`--data-urlencode ${JSON.stringify(`${k}=${String(v)}`)}`)
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    add(prefix ? `${prefix}[${key}]` : key, value)
  }
  return out
}

async function api(ctx: StripeCtx, toolName: string, args: unknown, method: 'GET' | 'POST', path: string, form?: Record<string, unknown>) {
  const fields = form ? ` ${formFields(form).join(' ')}` : ''
  const cmd = `curl -sf -X ${method} -u "$KEY:" "https://api.stripe.com/v1${path}"${fields}`
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

async function handleCustomerList(ctx: StripeCtx, args: z.infer<typeof customerListArgs>) {
  const qs = new URLSearchParams()
  if (args.email)          qs.set('email', args.email)
  if (args.limit !== undefined) qs.set('limit', String(args.limit))
  if (args.starting_after) qs.set('starting_after', args.starting_after)
  const q = qs.toString()
  return api(ctx, 'customerList', args, 'GET', `/customers${q ? `?${q}` : ''}`)
}

async function handleCustomerGet(ctx: StripeCtx, args: z.infer<typeof customerGetArgs>) {
  return api(ctx, 'customerGet', args, 'GET', `/customers/${encodeURIComponent(args.id)}`)
}

async function handleSubscriptionList(ctx: StripeCtx, args: z.infer<typeof subscriptionListArgs>) {
  const qs = new URLSearchParams()
  if (args.customer)        qs.set('customer', args.customer)
  if (args.status)          qs.set('status',   args.status)
  if (args.limit !== undefined) qs.set('limit', String(args.limit))
  if (args.starting_after)  qs.set('starting_after', args.starting_after)
  const q = qs.toString()
  return api(ctx, 'subscriptionList', args, 'GET', `/subscriptions${q ? `?${q}` : ''}`)
}

async function handleCheckoutCreate(ctx: StripeCtx, args: z.infer<typeof checkoutCreateArgs>) {
  return api(ctx, 'checkoutCreate', args, 'POST', '/checkout/sessions', args as unknown as Record<string, unknown>)
}

async function handlePing(ctx: StripeCtx, args: z.infer<typeof pingArgs>) {
  return api(ctx, 'ping', args, 'GET', '/account')
}

const DESC = {
  customerList:     'List customers, optionally filtered by exact email. Paginate with `starting_after` (the last customer id on the prior page).',
  customerGet:      'Fetch full customer record including default_source, invoice_settings, metadata.',
  subscriptionList: 'List subscriptions. Filter by customer or status ("active", "canceled", etc.).',
  checkoutCreate:   'Create a hosted Checkout session. Returns { id, url } — send the url to the buyer. Line items reference Price ids you\'ve set up in the Stripe dashboard.',
  ping:             'Verify the secret key by fetching /account.',
}

export function buildSdk(ctx: StripeCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): StripeCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('customerList',     DESC.customerList,     customerListArgs.shape,     async (a, x) => asText(await handleCustomerList(tu(x), a))),
    sdkTool('customerGet',      DESC.customerGet,      customerGetArgs.shape,      async (a, x) => asText(await handleCustomerGet(tu(x), a))),
    sdkTool('subscriptionList', DESC.subscriptionList, subscriptionListArgs.shape, async (a, x) => asText(await handleSubscriptionList(tu(x), a))),
    sdkTool('checkoutCreate',   DESC.checkoutCreate,   checkoutCreateArgs.shape,   async (a, x) => asText(await handleCheckoutCreate(tu(x), a))),
    sdkTool('ping',             DESC.ping,             pingArgs.shape,             async (a, x) => asText(await handlePing(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `stripe:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: StripeCtx) {
  const p = `stripe-${ctx.connectionName}`
  return {
    [`${p}-customerList`]:     tool({ description: DESC.customerList,     inputSchema: customerListArgs,     execute: a => handleCustomerList(ctx, a) }),
    [`${p}-customerGet`]:      tool({ description: DESC.customerGet,      inputSchema: customerGetArgs,      execute: a => handleCustomerGet(ctx, a) }),
    [`${p}-subscriptionList`]: tool({ description: DESC.subscriptionList, inputSchema: subscriptionListArgs, execute: a => handleSubscriptionList(ctx, a) }),
    [`${p}-checkoutCreate`]:   tool({ description: DESC.checkoutCreate,   inputSchema: checkoutCreateArgs,   execute: a => handleCheckoutCreate(ctx, a) }),
    [`${p}-ping`]:             tool({ description: DESC.ping,             inputSchema: pingArgs,             execute: a => handlePing(ctx, a) }),
  }
}
