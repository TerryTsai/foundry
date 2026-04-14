import type { ConnectionProvider } from './provider.js'
import { modelFactoryByKind } from '../runtime/models.js'
import { connectionTools } from '../mcp/server.js'

import { anthropic }             from './anthropic.js'
import { anthropicSubscription } from './anthropic-subscription.js'
import { openai }                from './openai.js'
import { cloudflare }            from './cloudflare.js'

// Static, in-repo list. Adding a new connection kind = create one file
// in this directory and append it here. No dynamic loading, no plugins.
const providers: ConnectionProvider[] = [
  anthropic,
  anthropicSubscription,
  openai,
  cloudflare,
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
    tool_names:  connectionTools(p.kind).map(t => t.name),
  }
}
