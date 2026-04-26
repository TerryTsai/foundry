import type { ConnectionProvider } from '../schema.js'

export const openai: ConnectionProvider = {
  kind: 'openai',
  name: 'OpenAI',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
  ],
}
