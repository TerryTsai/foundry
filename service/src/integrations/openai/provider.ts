import type { ConnectionProvider } from '../types.js'

export const openai: ConnectionProvider = {
  kind: 'openai',
  name: 'OpenAI',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
  ],
}
