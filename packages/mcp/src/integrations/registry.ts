// Static, in-repo registry of every third-party integration we support.
// Adding a new vendor: drop a folder under integrations/<kind>/ with a
// provider.ts (credential schema), optional tools.ts (MCP handlers),
// then append it to the lists below. No dynamic loading, no plugins.
//
// Two kinds of integration:
//   - LLM providers (anthropic, anthropic-subscription, openai) — provider
//     only. Consumed by the engine layer via model-factory.
//   - API integrations (cloudflare, aws, clerk, stripe, …) — provider +
//     tools. tools mounted per session by the engine layer when the
//     agent's account has a connection of that kind.
//
// github is a special case: see ../tools/registry.ts.
// Its tools live at integrations/github/tools.ts (collocated) but are
// loaded as a built-in because auth is via GitHub App config, not a
// user-stored connection.

import type { ConnectionProvider } from './types.js'

// Provider definitions
import { anthropic }             from './anthropic/provider.js'
import { anthropicSubscription } from './anthropic-subscription/provider.js'
import { openai }                from './openai/provider.js'
import { aws }                   from './aws/provider.js'
import { cloudflare }            from './cloudflare/provider.js'
import { clerk }                 from './clerk/provider.js'
import { stripe }                from './stripe/provider.js'
import { supabase }              from './supabase/provider.js'
import { sentry }                from './sentry/provider.js'
import { posthog }               from './posthog/provider.js'
import { resend }                from './resend/provider.js'
import { linear }                from './linear/provider.js'
import { uptimerobot }           from './uptimerobot/provider.js'
import { calcom }                from './calcom/provider.js'
import { crisp }                 from './crisp/provider.js'

// Vendor tool modules (connection-bound MCP tools)
import * as awsTools         from './aws/tools.js'
import * as cloudflareTools  from './cloudflare/tools.js'
import * as clerkTools       from './clerk/tools.js'
import * as stripeTools      from './stripe/tools.js'
import * as supabaseTools    from './supabase/tools.js'
import * as sentryTools      from './sentry/tools.js'
import * as posthogTools     from './posthog/tools.js'
import * as resendTools      from './resend/tools.js'
import * as linearTools      from './linear/tools.js'
import * as uptimerobotTools from './uptimerobot/tools.js'
import * as calcomTools      from './calcom/tools.js'
import * as crispTools       from './crisp/tools.js'

const providers: ConnectionProvider[] = [
  anthropic, anthropicSubscription, openai,
  aws, cloudflare, clerk, stripe, supabase,
  sentry, posthog, resend, linear, uptimerobot, calcom, crisp,
]

// Connection-bound tool modules — keyed by ConnectionProvider.kind.
// Engines look this map up at session start to mount the agent's
// vendor-tool servers.
export const byConnectionKind = {
  aws: awsTools, cloudflare: cloudflareTools,
  clerk: clerkTools, stripe: stripeTools, supabase: supabaseTools,
  sentry: sentryTools, posthog: posthogTools, resend: resendTools,
  linear: linearTools, uptimerobot: uptimerobotTools,
  calcom: calcomTools, crisp: crispTools,
}

// Subset of providers that are LLM backends (have a model factory).
// Used by providerMetadata to flag has_model in the UI.
const HAS_MODEL = new Set(['anthropic', 'openai'])  // anthropic-subscription bypasses model-factory; SDK consumes its token directly

const byKind = new Map(providers.map(p => [p.kind, p]))

export function providerGet(kind: string): ConnectionProvider | undefined {
  return byKind.get(kind)
}

export function providerList(): ConnectionProvider[] {
  return providers
}

export function supportedKinds(): string[] {
  return providers.map(p => p.kind)
}

export interface ProviderMetadata {
  kind:         string
  name:         string
  credentials:  ConnectionProvider['credentials']
  has_model:    boolean
  tool_names:   string[]
}

export function providerMetadata(p: ConnectionProvider): ProviderMetadata {
  const tools = byConnectionKind[p.kind as keyof typeof byConnectionKind]?.tools ?? []
  return {
    kind:        p.kind,
    name:        p.name,
    credentials: p.credentials,
    has_model:   HAS_MODEL.has(p.kind),
    tool_names:  tools.map((t: { name: string }) => t.name),
  }
}
