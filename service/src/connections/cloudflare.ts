import type { ConnectionProvider } from './types.js'

// Cloudflare credentials. Tools live in mcp/cloudflare.ts.
//
// Token needs, depending on which tools are used:
//   - Zone:Read + DNS:Read for listing zones / DNS records
//   - Cache Purge:Purge for purgeCache
//   - Workers Scripts:Read + Pages:Read for listing
//   - Pages:Edit for deploy
// Create tokens at https://dash.cloudflare.com/profile/api-tokens.

export const cloudflare: ConnectionProvider = {
  kind: 'cloudflare',
  name: 'Cloudflare',
  credentials: [
    {
      key: 'api_token',  label: 'API Token', type: 'password',
      placeholder: 'cloudflare API token (scoped, not the global key)',
      help: 'Create one at dash.cloudflare.com/profile/api-tokens with the permissions you want the agent to have.',
    },
    {
      key: 'account_id', label: 'Account ID', type: 'text', required: false,
      help: 'Default account scope for tools that need it. Optional; tools can override per-call.',
    },
  ],

  validate: (secrets, _config) => {
    const token = typeof secrets.api_token === 'string' ? secrets.api_token.trim() : ''
    if (!token) return 'api_token is required'
    return null
  },
}
