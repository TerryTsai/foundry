import type { ConnectionProvider } from './types.js'

export const calcom: ConnectionProvider = {
  kind: 'calcom',
  name: 'Cal.com',
  credentials: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'cal_live_…', help: 'Create at app.cal.com/settings/developer/api-keys.' },
  ],
}
