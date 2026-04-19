import type { ConnectionProvider } from './types.js'

export const cloudflare: ConnectionProvider = {
  kind: 'cloudflare',
  name: 'Cloudflare',
  credentials: [
    { key: 'api_token',  label: 'API Token',  type: 'password', placeholder: 'cfat_…', help: 'Create at dash.cloudflare.com/profile/api-tokens. Scope to the permissions you want the agent to have (Pages, R2, D1, KV, Zone Read, Cache Purge).' },
    { key: 'account_id', label: 'Account ID', type: 'text', required: false, help: 'Default account scope. Optional; tools can override per-call.' },
  ],
  validate: (secrets) => {
    const token = typeof secrets.api_token === 'string' ? secrets.api_token.trim() : ''
    if (!token) return 'api_token is required'
    return null
  },
}
