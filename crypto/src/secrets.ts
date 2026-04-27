import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// AES-256-GCM at-rest encryption. Format on disk:
//   enc:v1:<base64(nonce ‖ ciphertext ‖ authTag)>
// The version prefix lets us key-rotate later (enc:v2:…) without a flag day.
//
// The encryption key is owned by the composition root (server) and
// threaded in by every caller — no module-level cached state.

export function isEncrypted(stored: string): boolean {
  return stored.startsWith('enc:v1:')
}

export function encryptSecret(plain: string, key: Buffer): string {
  const nonce  = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ct     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return 'enc:v1:' + Buffer.concat([nonce, ct, tag]).toString('base64')
}

// Accepts both encrypted and legacy plaintext; transparent to callers.
export function decryptSecret(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) return stored
  const blob = Buffer.from(stored.slice('enc:v1:'.length), 'base64')
  if (blob.length < 12 + 16) throw new Error('encrypted blob too short')
  return decryptBlob(key, blob)
}

function decryptBlob(key: Buffer, blob: Buffer): string {
  const nonce = blob.subarray(0, 12)
  const tag   = blob.subarray(blob.length - 16)
  const ct    = blob.subarray(12, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
