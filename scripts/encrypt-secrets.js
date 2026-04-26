#!/usr/bin/env node
// One-shot migration: encrypt every connection.secrets row that's still
// plaintext (no `enc:v1:` prefix). Idempotent — already-encrypted rows are
// skipped, so re-running is safe.
//
// Usage:
//   FOUNDRY_ENCRYPTION_KEY=<hex> node scripts/encrypt-secrets.js [db-path]
//
// Default db-path: ./server/foundry.db
//
// Reads the encryption key from FOUNDRY_ENCRYPTION_KEY and uses the same
// AES-256-GCM format as packages/crud/src/secrets.ts.

const Database = require('better-sqlite3')
const { createCipheriv, randomBytes } = require('crypto')

const ENC_PREFIX = 'enc:v1:'
const NONCE_LEN  = 12

function loadKey() {
  const raw = process.env.FOUNDRY_ENCRYPTION_KEY
  if (!raw) {
    console.error('FOUNDRY_ENCRYPTION_KEY is required')
    process.exit(2)
  }
  let buf
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex')
  } else if (/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(raw)) {
    buf = Buffer.from(raw, 'base64')
  } else {
    console.error('FOUNDRY_ENCRYPTION_KEY must be 32 bytes (hex 64 chars or base64)')
    process.exit(2)
  }
  if (buf.length !== 32) {
    console.error(`FOUNDRY_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`)
    process.exit(2)
  }
  return buf
}

function encryptSecret(plain, key) {
  const nonce  = randomBytes(NONCE_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ct     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([nonce, ct, tag]).toString('base64')
}

const dbPath = process.argv[2] ?? './server/foundry.db'
const key    = loadKey()
const db     = new Database(dbPath)

const rows = db.prepare('SELECT id, secrets FROM connection').all()
let encrypted = 0
let skipped   = 0

const update = db.prepare('UPDATE connection SET secrets = ? WHERE id = ?')

const migrate = db.transaction(() => {
  for (const row of rows) {
    if (typeof row.secrets !== 'string' || row.secrets.length === 0) {
      skipped += 1
      continue
    }
    if (row.secrets.startsWith(ENC_PREFIX)) {
      skipped += 1
      continue
    }
    const enc = encryptSecret(row.secrets, key)
    update.run(enc, row.id)
    encrypted += 1
  }
})

migrate()

console.log(`encrypted ${encrypted} row(s), skipped ${skipped} (already encrypted or empty)`)
console.log(`db: ${dbPath}`)
