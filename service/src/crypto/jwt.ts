import { createHmac, timingSafeEqual } from 'crypto'

// Tiny HMAC-SHA256 token format used for per-session sandbox auth.
// Stateless: no DB row, no lookup. Claims travel with the token; the
// signature proves they were issued by Foundry. Format on the wire:
//
//   sb_<base64url(json(claims))>.<base64url(hmac-sha256)>
//
// Key source: FOUNDRY_ENCRYPTION_KEY (already required at boot for
// connection-secret encryption; reused here for HMAC). The two uses are
// cryptographically independent — HMAC and AES-GCM with the same key
// don't leak each other.
//
// No mid-flight revocation: once minted, valid until exp. For Foundry's
// single-user setup this is fine — sessions are short, the leak window
// is the TTL, and the cancel-doesn't-actually-stop-the-agent issue makes
// table-based revocation worth less than it sounds.

const PREFIX = 'sb_'

export interface SessionClaims {
  v:   1                // version, lets us evolve the claim shape later
  sid: string           // session_id
  tid: string           // ticket_id
  pid: string           // project_id
  aid: string           // account_id (resolved from project owner at mint)
  exp: number           // unix seconds
}

let cachedKey: Buffer | null = null

function loadKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.FOUNDRY_ENCRYPTION_KEY
  if (!raw) throw new Error('FOUNDRY_ENCRYPTION_KEY is not set')
  let buf: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex')
  else if (/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(raw)) buf = Buffer.from(raw, 'base64')
  else throw new Error('FOUNDRY_ENCRYPTION_KEY must be 32 bytes (hex 64 chars or base64)')
  if (buf.length !== 32) throw new Error(`FOUNDRY_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`)
  cachedKey = buf
  return buf
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url')
}

export function isSessionJwt(token: string): boolean {
  return token.startsWith(PREFIX)
}

export function signSessionJwt(claims: SessionClaims): string {
  const payload = b64u(Buffer.from(JSON.stringify(claims), 'utf-8'))
  const sig     = b64u(createHmac('sha256', loadKey()).update(payload).digest())
  return `${PREFIX}${payload}.${sig}`
}

export function verifySessionJwt(token: string): SessionClaims | null {
  if (!isSessionJwt(token)) return null
  const body = token.slice(PREFIX.length)
  const dot  = body.indexOf('.')
  if (dot < 0) return null
  const payload = body.slice(0, dot)
  const sig     = body.slice(dot + 1)
  if (!payload || !sig) return null

  const expected = createHmac('sha256', loadKey()).update(payload).digest()
  let provided: Buffer
  try { provided = Buffer.from(sig, 'base64url') } catch { return null }
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  let claims: SessionClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionClaims
  } catch { return null }
  if (claims.v !== 1) return null
  if (claims.exp < Math.floor(Date.now() / 1000)) return null
  return claims
}
