import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Connection } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { ok, err, now, timestamps } from '@foundry/model'
import type {
  connection as validate,
  MaskedConnection, ConnectionProviderSpec, ProviderGet, SupportedKindsFn,
  EncryptSecret, DecryptSecret,
} from './schema.js'
import * as database from './repo.js'

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function maskPreview(secrets: string, providerGet: ProviderGet, kind: string, decryptSecret: DecryptSecret): string | null {
  try {
    const parsed = JSON.parse(decryptSecret(secrets)) as Record<string, unknown>
    const passwordKeys = passwordKeysFor(providerGet, kind)
    return firstPasswordPreview(parsed, passwordKeys)
  } catch {
    return null
  }
}

function passwordKeysFor(providerGet: ProviderGet, kind: string): string[] {
  const provider = providerGet(kind)
  if (!provider) return ['api_key']
  return provider.credentials.filter(f => f.type === 'password').map(f => f.key)
}

function firstPasswordPreview(parsed: Record<string, unknown>, passwordKeys: string[]): string | null {
  for (const k of passwordKeys) {
    const v = parsed[k]
    if (typeof v === 'string' && v.length > 0) return maskKey(v)
  }
  return null
}

function maskConnection(c: Connection, providerGet: ProviderGet, decryptSecret: DecryptSecret): MaskedConnection {
  const { secrets, ...rest } = c
  return { ...rest, api_key_preview: maskPreview(secrets, providerGet, c.kind, decryptSecret) }
}

export function connectionList(
  db: Db, accountId: string, providerGet: ProviderGet, decryptSecret: DecryptSecret,
): Result<MaskedConnection[], CrudError> {
  const rows = database.connectionAll(db, [eq(schema.connection.account_id, accountId)])
  return ok(rows.map(c => maskConnection(c, providerGet, decryptSecret)))
}

export function connectionGet(
  db: Db, accountId: string, id: string, providerGet: ProviderGet, decryptSecret: DecryptSecret,
): Result<MaskedConnection, CrudError> {
  const row = database.connectionGet(db, id)
  if (!row || row.account_id !== accountId) return err({ kind: 'not_found', entity: 'connection', id })
  return ok(maskConnection(row, providerGet, decryptSecret))
}

export function connectionCreate(
  db: Db, accountId: string, input: z.infer<typeof validate.create>,
  providerGet: ProviderGet, supportedKinds: SupportedKindsFn,
  encryptSecret: EncryptSecret, decryptSecret: DecryptSecret,
): Result<MaskedConnection, CrudError> {
  const provider = providerGet(input.kind)
  if (!provider) return err({ kind: 'validation_failed', field: 'kind', reason: `unsupported connection kind '${input.kind}' — supported: ${supportedKinds().join(', ')}` })
  if (database.connectionGetByName(db, input.name)) return err({ kind: 'conflict', reason: `connection '${input.name}' already exists` })
  const validated = validateConnectionInput(provider, input)
  if (!validated.ok) return validated
  return ok(maskConnection(connectionCreateInsert(db, accountId, input, encryptSecret), providerGet, decryptSecret))
}

function validateConnectionInput(
  provider: ConnectionProviderSpec, input: z.infer<typeof validate.create>,
): Result<void, CrudError> {
  const secrets = (input.secrets ?? {}) as Record<string, unknown>
  const config  = (input.config  ?? {}) as Record<string, unknown>
  const fieldErr = validateRequiredCredentials(provider, secrets, input.kind)
  if (fieldErr) return err(fieldErr)
  if (provider.validate) {
    const msg = provider.validate(secrets, config)
    if (msg) return err({ kind: 'validation_failed', field: 'secrets', reason: msg })
  }
  return ok(undefined)
}

function validateRequiredCredentials(
  provider: ConnectionProviderSpec, secrets: Record<string, unknown>, kind: string,
): CrudError | null {
  for (const f of provider.credentials) {
    if (f.required === false) continue
    const v = secrets[f.key]
    if (typeof v !== 'string' || v.trim() === '') {
      return { kind: 'validation_failed', field: f.key, reason: `connection kind '${kind}' requires credential '${f.key}' (${f.label})` }
    }
  }
  return null
}

function connectionCreateInsert(
  db: Db, accountId: string, input: z.infer<typeof validate.create>, encryptSecret: EncryptSecret,
): Connection {
  return database.connectionInsert(db, {
    account_id: accountId, kind: input.kind, name: input.name,
    config:  JSON.stringify(input.config  ?? {}),
    secrets: encryptSecret(JSON.stringify(input.secrets ?? {})),
    ...timestamps(),
  })
}

export function connectionUpdate(
  db: Db, accountId: string, id: string,
  input: z.infer<typeof validate.update>, providerGet: ProviderGet,
  encryptSecret: EncryptSecret, decryptSecret: DecryptSecret,
): Result<MaskedConnection, CrudError> {
  const row = database.connectionGet(db, id)
  if (!row || row.account_id !== accountId) return err({ kind: 'not_found', entity: 'connection', id })
  const data: Record<string, unknown> = { updated_at: now() }
  if (input.name    !== undefined) data.name    = input.name
  if (input.config  !== undefined) data.config  = JSON.stringify(input.config)
  if (input.secrets !== undefined) data.secrets = encryptSecret(JSON.stringify(input.secrets))
  return ok(maskConnection(database.connectionUpdate(db, id, data), providerGet, decryptSecret))
}

export function connectionRemove(db: Db, accountId: string, id: string): Result<{ ok: true }, CrudError> {
  const row = database.connectionGet(db, id)
  if (!row || row.account_id !== accountId) return err({ kind: 'not_found', entity: 'connection', id })
  database.connectionRemove(db, id)
  return ok({ ok: true })
}
