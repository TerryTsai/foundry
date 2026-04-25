import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// AES-256-GCM at-rest encryption for connection.secrets and any other
// credential-bearing column. Format on disk:
//
//   enc:v1:<base64(nonce ‖ ciphertext ‖ authTag)>
//
// nonce: 12 bytes (GCM standard)
// authTag: 16 bytes (GCM standard, appended)
//
// The version prefix lets us key-rotate later (enc:v2:…) without a flag day.
// decryptSecret accepts both encrypted strings AND raw plaintext, so reads
// keep working through the migration window. Once all rows are encrypted,
// the legacy branch becomes dead code (Phase 2 removes it).

const ENC_PREFIX = 'enc:v1:'
const NONCE_LEN  = 12
const TAG_LEN    = 16
const KEY_LEN    = 32   // AES-256

let cachedKey: Buffer | null = null

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
function loadKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.FOUNDRY_ENCRYPTION_KEY
  if (!raw) throw new Error('FOUNDRY_ENCRYPTION_KEY is not set')
  // Accept hex (64 chars) or base64 (44 chars padded). Reject anything else
  // so a malformed key fails at boot, not on the first encrypt call.
  let buf: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex')
  } else if (/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(raw)) {
    buf = Buffer.from(raw, 'base64')
  } else {
    throw new Error('FOUNDRY_ENCRYPTION_KEY must be 32 bytes encoded as hex (64 chars) or base64')
  }
  if (buf.length !== KEY_LEN) {
    throw new Error(`FOUNDRY_ENCRYPTION_KEY must decode to exactly ${KEY_LEN} bytes (got ${buf.length})`)
  }
  cachedKey = buf
  return buf
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX)
}

export function encryptSecret(plain: string): string {
  const key   = loadKey()
  const nonce = randomBytes(NONCE_LEN)
  const cipher  = createCipheriv('aes-256-gcm', key, nonce)
  const ct      = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag     = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([nonce, ct, tag]).toString('base64')
}

// Accepts both encrypted ("enc:v1:…") and legacy plaintext strings. During
// the migration window, callers don't need to know which they're holding —
// they always ask for the plaintext. After Phase 2 the legacy branch goes
// away and any non-prefixed value is treated as corruption.
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored
  const key  = loadKey()
  const blob = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
  if (blob.length < NONCE_LEN + TAG_LEN) throw new Error('encrypted blob too short')
  const nonce = blob.subarray(0, NONCE_LEN)
  const tag   = blob.subarray(blob.length - TAG_LEN)
  const ct    = blob.subarray(NONCE_LEN, blob.length - TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// Eager validation so a missing/malformed key fails at boot, not on the
// first connection write. Call from server bootstrap.
export function assertKeyConfigured(): void {
  loadKey()
}
