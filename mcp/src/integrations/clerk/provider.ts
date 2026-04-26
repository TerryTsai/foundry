import type { ConnectionProvider } from '../schema.js'

export const clerk: ConnectionProvider = {
  kind: 'clerk',
  name: 'Clerk',
  credentials: [
    { key: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_live_… or sk_test_…' },
  ],
}
