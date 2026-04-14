import { createOpenAI } from '@ai-sdk/openai'
import type { ConnectionProvider } from './provider.js'

export const openai: ConnectionProvider = {
  kind: 'openai',
  name: 'OpenAI',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
  ],
  modelFactory: (apiKey) => createOpenAI({ apiKey }),
}
