import type { ConnectionProvider } from '../schema.js'

export const supabase: ConnectionProvider = {
  kind: 'supabase',
  name: 'Supabase',
  credentials: [
    { key: 'project_url',      label: 'Project URL',      type: 'text',     placeholder: 'https://<ref>.supabase.co' },
    { key: 'service_role_key', label: 'Service Role Key', type: 'password', help: 'Use service_role for server-side ops. Never put this in frontend code.' },
  ],
}
