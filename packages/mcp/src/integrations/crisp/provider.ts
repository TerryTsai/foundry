import type { ConnectionProvider } from '../schema.js'

export const crisp: ConnectionProvider = {
  kind: 'crisp',
  name: 'Crisp',
  credentials: [
    { key: 'identifier', label: 'Identifier', type: 'text',     help: 'Plugin identifier from marketplace.crisp.chat.' },
    { key: 'key',        label: 'Key',        type: 'password' },
    { key: 'website_id', label: 'Website ID', type: 'text',     help: 'From the Crisp dashboard URL (…/website/<id>/).' },
  ],
}
