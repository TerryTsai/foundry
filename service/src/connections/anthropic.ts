import { createAnthropic } from '@ai-sdk/anthropic'
import type { ConnectionProvider } from './provider.js'

export const anthropic: ConnectionProvider = {
  kind: 'anthropic',
  name: 'Anthropic',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
  ],
  modelFactory: (apiKey) => createAnthropic({ apiKey }),
}
