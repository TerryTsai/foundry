import type { ConnectionProvider } from './types.js'

export const anthropicSubscription: ConnectionProvider = {
  kind: 'anthropic-subscription',
  name: 'Anthropic (Claude Pro/Max subscription)',
  credentials: [
    { key: 'access_token',  label: 'Access Token',  type: 'password', help: 'From `claude setup-token`. The runtime resolves tokens from stored credentials and refreshes from ~/.claude/.credentials.json when available.' },
    { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: false, help: 'Optional; used for auto-refresh.' },
  ],
}
