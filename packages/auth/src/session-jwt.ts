import { createHmac, timingSafeEqual } from 'crypto'

import { type Db } from '@foundry/db'
import type { Result, AuthError } from '@foundry/model'
import { ok, err } from '@foundry/model'

import type { AuthCrudOps } from './types.js'

// Per-session sandbox auth — stateless HMAC-SHA256 JWT.
//
// On the wire:  sb_<base64url(json(claims))>.<base64url(hmac-sha256)>

const PREFIX        = 'sb_'
const DEFAULT_TTL_MS = 30 * 60 * 1000

export interface SessionClaims {
  v:   1
  sid: string
  tid: string
  pid: string
  aid: string
  exp: number
}

export function isSandboxToken(token: string): boolean {
  return token.startsWith(PREFIX)
}

export function mint(
  db: Db, crud: AuthCrudOps, sessionId: string, ttlMs: number = DEFAULT_TTL_MS,
): Result<string, AuthError> {
  const session = crud.sessionGet(db, sessionId)
  if (!session) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const ticket = crud.ticketGet(db, session.ticket_id)
  if (!ticket) return err({ kind: 'not_found', entity: 'ticket', id: session.ticket_id })
  return mintForTicket(db, crud, session, ticket, ttlMs)
}

function mintForTicket(
  db: Db, crud: AuthCrudOps,
  session: { id: string }, ticket: { id: string; project_id: string }, ttlMs: number,
): Result<string, AuthError> {
  const project = crud.projectGet(db, ticket.project_id)
  if (!project) return err({ kind: 'not_found', entity: 'project', id: ticket.project_id })
  if (!project.owner_id) return err({ kind: 'internal', message: `project '${project.id}' has no owner — cannot mint sandbox token` })
  const exp = Math.floor((Date.now() + ttlMs) / 1000)
  return ok(sign({ v: 1, sid: session.id, tid: ticket.id, pid: project.id, aid: project.owner_id, exp }))
}

export function verify(token: string): SessionClaims | null {
  if (!isSandboxToken(token)) return null
  const parsed = parseToken(token)
  if (!parsed) return null
  if (!verifySignature(parsed.payload, parsed.sigB64)) return null
  return parseClaims(parsed.payload)
}

function parseToken(token: string): { payload: string; sigB64: string } | null {
  const body = token.slice(PREFIX.length)
  const dot  = body.indexOf('.')
  if (dot < 0) return null
  const payload = body.slice(0, dot)
  const sigB64  = body.slice(dot + 1)
  if (!payload || !sigB64) return null
  return { payload, sigB64 }
}

function verifySignature(payload: string, sigB64: string): boolean {
  const expected = createHmac('sha256', loadKey()).update(payload).digest()
  let provided: Buffer
  try { provided = Buffer.from(sigB64, 'base64url') } catch { return false }
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

function parseClaims(payload: string): SessionClaims | null {
  let claims: SessionClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionClaims
  } catch { return null }
  if (claims.v !== 1) return null
  if (claims.exp < Math.floor(Date.now() / 1000)) return null
  return claims
}

let cachedKey: Buffer | null = null

function loadKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.FOUNDRY_ENCRYPTION_KEY
  if (!raw) throw new Error('FOUNDRY_ENCRYPTION_KEY is not set')
  const buf = decodeKey(raw)
  if (buf.length !== 32) throw new Error(`FOUNDRY_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`)
  cachedKey = buf
  return buf
}

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(raw)) return Buffer.from(raw, 'base64')
  throw new Error('FOUNDRY_ENCRYPTION_KEY must be 32 bytes (hex 64 chars or base64)')
}

function sign(claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url')
  const sig     = createHmac('sha256', loadKey()).update(payload).digest('base64url')
  return `${PREFIX}${payload}.${sig}`
}
