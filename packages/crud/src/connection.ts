import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Connection } from '@foundry/db'
import { mustExist, now, timestamps } from '@foundry/model'
import { conflict, badRequest, notFound } from '@foundry/model'
import { connection as validate } from './validators.js'
import { encryptSecret, decryptSecret } from './secrets-crypto.js'
import * as database from './repo.js'

// Masked shape returned by the API — secrets are never serialized directly.
// A preview of the first password field is shown so the UI can help operators
// confirm they're looking at the right credential.
export type MaskedConnection = Omit<Connection, 'secrets'> & { api_key_preview: string | null }

// Provider lookup is injected by the caller to keep the connection module
// free of cross-module imports. The route handler in server passes
// integrations.providerGet; callers that don't need kind validation can
// pass () => undefined and skip the validate step (input still gets a
// generic shape check).
export interface ConnectionProviderField {
  key:      string
  label:    string
  type?:    string
  required?: boolean
}
export interface ConnectionProviderSpec {
  kind:        string
  name:        string
  credentials: ConnectionProviderField[]
  validate?:   (secrets: Record<string, unknown>, config: Record<string, unknown>) => string | null
}
export type ProviderGet      = (kind: string) => ConnectionProviderSpec | undefined
export type SupportedKindsFn = () => string[]

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
function maskConnection(c: Connection, providerGet: ProviderGet): MaskedConnection {
  const { secrets, ...rest } = c
  let preview: string | null = null
  try {
    const parsed = JSON.parse(decryptSecret(secrets)) as Record<string, unknown>
    const provider = providerGet(c.kind)
    const passwordKeys = provider
      ? provider.credentials.filter(f => f.type === 'password').map(f => f.key)
      : ['api_key']
    for (const k of passwordKeys) {
      const v = parsed[k]
      if (typeof v === 'string' && v.length > 0) { preview = maskKey(v); break }
    }
  } catch { /* secrets not JSON or decryption failed — leave preview null */ }
  return { ...rest, api_key_preview: preview }
}

export function connectionList(db: Db, accountId: string, providerGet: ProviderGet): MaskedConnection[] {
  return database.connectionAll(db, [eq(schema.connection.account_id, accountId)]).map(c => maskConnection(c, providerGet))
}

export function connectionGet(db: Db, accountId: string, id: string, providerGet: ProviderGet): MaskedConnection {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  return maskConnection(row, providerGet)
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function connectionCreate(
  db: Db, accountId: string,
  input: z.infer<typeof validate.create>,
  providerGet: ProviderGet,
  supportedKinds: SupportedKindsFn,
): MaskedConnection {
  const provider = providerGet(input.kind)
  if (!provider) {
    throw badRequest(`unsupported connection kind '${input.kind}' — supported: ${supportedKinds().join(', ')}`)
  }
  if (database.connectionGetByName(db, input.name)) throw conflict(`connection '${input.name}' already exists`)

  const secrets = (input.secrets ?? {}) as Record<string, unknown>
  const config  = (input.config  ?? {}) as Record<string, unknown>
  for (const f of provider.credentials) {
    if (f.required === false) continue
    const v = secrets[f.key]
    if (typeof v !== 'string' || v.trim() === '') {
      throw badRequest(`connection kind '${input.kind}' requires credential '${f.key}' (${f.label})`)
    }
  }
  if (provider.validate) {
    const err = provider.validate(secrets, config)
    if (err) throw badRequest(err)
  }

  const row = database.connectionInsert(db, {
    account_id: accountId,
    kind:       input.kind,
    name:       input.name,
    config:     JSON.stringify(config),
    secrets:    encryptSecret(JSON.stringify(secrets)),
    ...timestamps(),
  })
  return maskConnection(row, providerGet)
}

export function connectionUpdate(
  db: Db, accountId: string, id: string,
  input: z.infer<typeof validate.update>,
  providerGet: ProviderGet,
): MaskedConnection {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  const data: Record<string, unknown> = { updated_at: now() }
  if (input.name    !== undefined) data.name    = input.name
  if (input.config  !== undefined) data.config  = JSON.stringify(input.config)
  if (input.secrets !== undefined) data.secrets = encryptSecret(JSON.stringify(input.secrets))
  return maskConnection(database.connectionUpdate(db, id, data), providerGet)
}

export function connectionRemove(db: Db, accountId: string, id: string): { ok: true } {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  database.connectionRemove(db, id)
  return { ok: true }
}
