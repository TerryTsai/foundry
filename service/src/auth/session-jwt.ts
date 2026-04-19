import { createHmac, timingSafeEqual } from 'crypto'

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import { mustExist } from '../core/util.js'

// Per-session sandbox auth — stateless HMAC-SHA256 JWT.
//
// On the wire:  sb_<base64url(json(claims))>.<base64url(hmac-sha256)>
//
// The signing key is FOUNDRY_ENCRYPTION_KEY (already required at boot for
// connection-secret encryption). HMAC-SHA256 and AES-256-GCM with the
// same key are cryptographically independent.
//
// No mid-flight revocation. Once minted, the token is valid until exp.
// For this single-user setup that's fine — sessions are short, and the
// cancel-doesn't-actually-stop-the-agent issue makes table-based
// revocation worth less than it sounds.

const PREFIX        = 'sb_'
const DEFAULT_TTL_MS = 30 * 60 * 1000

export interface SessionClaims {
  v:   1                // claim shape version
  sid: string           // session_id
  tid: string           // ticket_id
  pid: string           // project_id
  aid: string           // account_id (resolved from project owner at mint)
  exp: number           // unix seconds
}

// ── public API ────────────────────────────────────────────────────────

export function isSandboxToken(token: string): boolean {
  return token.startsWith(PREFIX)
}

export function mint(db: Db, sessionId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const session = mustExist(database.sessionGet(db, sessionId), `session '${sessionId}' not found`)
  const ticket  = mustExist(database.ticketGet(db, session.ticket_id), `ticket '${session.ticket_id}' not found`)
  const project = mustExist(database.projectGet(db, ticket.project_id), `project '${ticket.project_id}' not found`)
  if (!project.owner_id) throw new Error(`project '${project.id}' has no owner — cannot mint sandbox token`)
  return sign({
    v: 1, sid: session.id, tid: ticket.id, pid: project.id, aid: project.owner_id,
    exp: Math.floor((Date.now() + ttlMs) / 1000),
  })
}

export function verify(token: string): SessionClaims | null {
  if (!isSandboxToken(token)) return null
  const body = token.slice(PREFIX.length)
  const dot  = body.indexOf('.')
  if (dot < 0) return null
  const payload = body.slice(0, dot)
  const sigB64  = body.slice(dot + 1)
  if (!payload || !sigB64) return null

  const expected = createHmac('sha256', loadKey()).update(payload).digest()
  let provided: Buffer
  try { provided = Buffer.from(sigB64, 'base64url') } catch { return null }
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

// ── internals ─────────────────────────────────────────────────────────

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

function sign(claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url')
  const sig     = createHmac('sha256', loadKey()).update(payload).digest('base64url')
  return `${PREFIX}${payload}.${sig}`
}
