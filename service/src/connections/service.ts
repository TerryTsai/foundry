import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import * as schema from '../core/schema.js'
import type { Connection } from '../core/schema.js'
import { mustExist, now, timestamps } from '../core/util.js'
import { conflict, badRequest, notFound } from '../core/errors.js'
import * as providers from '../agent-runtime/providers/registry.js'
import * as validate from './schema.js'
import { encryptSecret, decryptSecret } from '../connections/secrets-crypto.js'

// Masked shape returned by the API — secrets are never serialized directly.
// A preview of the first password field is shown so the UI can help operators
// confirm they're looking at the right credential.
export type MaskedConnection = Omit<Connection, 'secrets'> & { api_key_preview: string | null }

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function maskConnection(c: Connection): MaskedConnection {
  const { secrets, ...rest } = c
  let preview: string | null = null
  try {
    const parsed = JSON.parse(decryptSecret(secrets)) as Record<string, unknown>
    const provider = providers.providerGet(c.kind)
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

export function connectionList(db: Db, accountId: string): MaskedConnection[] {
  return database.connectionAll(db, [eq(schema.connection.account_id, accountId)]).map(maskConnection)
}

export function connectionGet(db: Db, accountId: string, id: string): MaskedConnection {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  return maskConnection(row)
}

export function connectionCreate(db: Db, accountId: string, input: z.infer<typeof validate.connectionCreate>): MaskedConnection {
  const provider = providers.providerGet(input.kind)
  if (!provider) {
    throw badRequest(`unsupported connection kind '${input.kind}' — supported: ${providers.supportedKinds().join(', ')}`)
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
  return maskConnection(row)
}

export function connectionUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.connectionUpdate>): MaskedConnection {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  const data: Record<string, unknown> = { updated_at: now() }
  if (input.name    !== undefined) data.name    = input.name
  if (input.config  !== undefined) data.config  = JSON.stringify(input.config)
  if (input.secrets !== undefined) data.secrets = encryptSecret(JSON.stringify(input.secrets))
  return maskConnection(database.connectionUpdate(db, id, data))
}

export function connectionRemove(db: Db, accountId: string, id: string): { ok: true } {
  const row = mustExist(database.connectionGet(db, id), `connection '${id}' not found`)
  if (row.account_id !== accountId) throw notFound()
  database.connectionRemove(db, id)
  return { ok: true }
}
