import type { ConnectionProvider } from '../types.js'

export const stripe: ConnectionProvider = {
  kind: 'stripe',
  name: 'Stripe',
  credentials: [
    { key: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_live_… or sk_test_…' },
  ],
}
