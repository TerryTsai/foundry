import type { ConnectionProvider } from '../schema.js'

export const linear: ConnectionProvider = {
  kind: 'linear',
  name: 'Linear',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'lin_api_…', help: 'Create at linear.app/settings/api.' },
  ],
}
