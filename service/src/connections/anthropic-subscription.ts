import type { ConnectionProvider } from './types.js'

// The subscription kind is handled by runtime/sdk-runner.ts directly via
// the Claude Agent SDK and CLAUDE_CODE_OAUTH_TOKEN. No `modelFactory` —
// the runner resolves the token from the stored credentials (and refreshes
// from ~/.claude/.credentials.json when available).
//
// Obtain tokens by running `claude setup-token` locally and pasting the
// result here.
export const anthropicSubscription: ConnectionProvider = {
  kind: 'anthropic-subscription',
  name: 'Anthropic (Claude Pro/Max subscription)',
  credentials: [
    { key: 'access_token',  label: 'Access Token',  type: 'password', help: 'From `claude setup-token`.' },
    { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: false, help: 'Optional; used for auto-refresh.' },
  ],
}
