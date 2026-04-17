import type { ConnectionProvider } from './types.js'
import { modelFactoryByKind } from '../runtime/loop/model.js'
import { byConnectionKind } from '../mcp/registry.js'

import { anthropic }             from './anthropic.js'
import { anthropicSubscription } from './anthropic-subscription.js'
import { openai }                from './openai.js'
import { cloudflare }            from './cloudflare.js'
import { aws }                   from './aws.js'
import { resend }                from './resend.js'
import { posthog }               from './posthog.js'
import { sentry }                from './sentry.js'
import { supabase }              from './supabase.js'
import { clerk }                 from './clerk.js'
import { stripe }                from './stripe.js'
import { linear }                from './linear.js'
import { uptimerobot }           from './uptimerobot.js'
import { calcom }                from './calcom.js'
import { crisp }                 from './crisp.js'

// Static, in-repo list. Adding a new connection kind = create one file
// in this directory and append it here. No dynamic loading, no plugins.
const providers: ConnectionProvider[] = [
  anthropic,
  anthropicSubscription,
  openai,
  cloudflare,
  aws,
  resend,
  posthog,
  sentry,
  supabase,
  clerk,
  stripe,
  linear,
  uptimerobot,
  calcom,
  crisp,
]

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

// Public metadata shape — never includes handlers, factories, or
// validators. Safe to serialize over the wire for the UI to render
// connection forms against.
export interface ProviderMetadata {
  kind:         string
  name:         string
  credentials:  ConnectionProvider['credentials']
  has_model:    boolean
  tool_names:   string[]
}

export function providerMetadata(p: ConnectionProvider): ProviderMetadata {
  return {
    kind:        p.kind,
    name:        p.name,
    credentials: p.credentials,
    has_model:   modelFactoryByKind[p.kind] !== undefined,
    tool_names:  byConnectionKind[p.kind as keyof typeof byConnectionKind]?.tools.map(t => t.name) ?? [],
  }
}
