import type { ConnectionProvider } from '../schema.js'

export const anthropic: ConnectionProvider = {
  kind: 'anthropic',
  name: 'Anthropic',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
  ],
}
