import type { ConnectionProvider } from '../schema.js'

export const resend: ConnectionProvider = {
  kind: 'resend',
  name: 'Resend',
  credentials: [
    { key: 'api_key',       label: 'API Key',        type: 'password', placeholder: 're_…' },
    { key: 'default_from',  label: 'Default From',   type: 'text',     required: false, help: 'Verified sender address used when a tool call omits `from`.' },
  ],
}
