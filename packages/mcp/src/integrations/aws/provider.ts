import type { ConnectionProvider } from '../types.js'

export const aws: ConnectionProvider = {
  kind: 'aws',
  name: 'AWS',
  credentials: [
    { key: 'access_key_id',     label: 'Access Key ID',     type: 'text',     placeholder: 'AKIA…' },
    { key: 'secret_access_key', label: 'Secret Access Key', type: 'password' },
    { key: 'region',            label: 'Default Region',    type: 'text',     placeholder: 'us-east-1', required: false, help: 'Used when a command omits --region.' },
  ],
}
