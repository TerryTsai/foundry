import { createHash, randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { type Db } from '../database.js'
import * as schema from '../tables.js'
import type { SandboxToken } from '../tables.js'

// Per-session sandbox tokens. The mint() return value is the only place
// the actual 32-byte token exists in plaintext; we store its SHA-256 so a
// DB compromise still requires the live token to forge a request.
//
// Format: sb_<base64url(32 random bytes)>
//
// Lifecycle:
//   mint()    — called from runSession before podman spawn
//   resolve() — called from requireAuth on every bearer request
//   revoke()  — called when the session terminates (success / fail / kill)
//
// Resolution returns the linked session row so the middleware can chain
// session → ticket → project → owner_id and populate req.account.

const PREFIX     = 'sb_'
const TOKEN_LEN  = 32  // bytes of entropy
const DEFAULT_TTL_MS = 30 * 60 * 1000  // 30 minutes; sandbox timeout default is 20

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isSandboxToken(token: string): boolean {
  return token.startsWith(PREFIX)
}

export function mint(db: Db, sessionId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const raw   = randomBytes(TOKEN_LEN).toString('base64url')
  const token = PREFIX + raw
  const created = new Date()
  const expires = new Date(created.getTime() + ttlMs)
  db.insert(schema.sandboxToken).values({
    id:         ulid(),
    session_id: sessionId,
    token_hash: hash(token),
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
    revoked_at: null,
  }).run()
  return token
}

export function resolve(db: Db, token: string): SandboxToken | undefined {
  if (!isSandboxToken(token)) return undefined
  const row = db.select().from(schema.sandboxToken)
    .where(eq(schema.sandboxToken.token_hash, hash(token)))
    .get() as SandboxToken | undefined
  if (!row) return undefined
  if (row.revoked_at) return undefined
  if (new Date(row.expires_at) < new Date()) return undefined
  return row
}

export function revoke(db: Db, sessionId: string): void {
  db.update(schema.sandboxToken)
    .set({ revoked_at: new Date().toISOString() })
    .where(eq(schema.sandboxToken.session_id, sessionId))
    .run()
}
