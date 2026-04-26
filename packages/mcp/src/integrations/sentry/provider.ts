import type { ConnectionProvider } from '../schema.js'

export const sentry: ConnectionProvider = {
  kind: 'sentry',
  name: 'Sentry',
  credentials: [
    { key: 'auth_token',   label: 'Auth Token',   type: 'password', placeholder: 'sntrys_…' },
    { key: 'organization', label: 'Organization', type: 'text',     placeholder: 'my-org' },
    { key: 'host',         label: 'Host',         type: 'text',     required: false, placeholder: 'https://sentry.io' },
  ],
}
