import type { ConnectionProvider } from './types.js'

export const uptimerobot: ConnectionProvider = {
  kind: 'uptimerobot',
  name: 'UptimeRobot',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'u…-…', help: 'Main or monitor-specific key from My Settings → API Settings.' },
  ],
}
