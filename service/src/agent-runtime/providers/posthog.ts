import type { ConnectionProvider } from './types.js'

export const posthog: ConnectionProvider = {
  kind: 'posthog',
  name: 'PostHog',
  credentials: [
    { key: 'api_key',    label: 'Personal API Key', type: 'password', placeholder: 'phx_…', help: 'Create at app.posthog.com/settings/user-api-keys.' },
    { key: 'project_id', label: 'Project ID',       type: 'text',     placeholder: '12345' },
    { key: 'host',       label: 'Host',             type: 'text',     required: false, placeholder: 'https://us.i.posthog.com' },
  ],
}
