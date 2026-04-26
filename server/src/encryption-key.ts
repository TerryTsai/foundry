// Read and decode the at-rest encryption key from env. Server is the
// only module that touches process.env for secrets; the decoded Buffer
// is threaded through closures into auth (sessionJwt) and crud
// (encryptSecret/decryptSecret) at composition time.

export function decodeEncryptionKey(raw: string): Buffer {
  if (!raw) throw new Error('FOUNDRY_ENCRYPTION_KEY is not set')
  const buf = decodeBase(raw)
  if (buf.length !== 32) throw new Error(`FOUNDRY_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`)
  return buf
}

function decodeBase(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(raw)) return Buffer.from(raw, 'base64')
  throw new Error('FOUNDRY_ENCRYPTION_KEY must be 32 bytes encoded as hex (64 chars) or base64')
}
