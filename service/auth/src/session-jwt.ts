import { createHmac, timingSafeEqual } from 'crypto'

import { type Db } from '@foundry/db'
import type { Result } from '@foundry/model'
import { ok, err } from '@foundry/model'

import type { AuthCrudOps, SessionClaims, AuthError } from './schema.js'

// Per-session sandbox auth — stateless HMAC-SHA256 JWT.
//
// On the wire:  sb_<base64url(json(claims))>.<base64url(hmac-sha256)>
//
// The encryption key is owned by the composition root and threaded
// in by the caller — no module-level cached state here.

export function isSandboxToken(token: string): boolean {
  return token.startsWith('sb_')
}

export function mint(
  db: Db, crud: AuthCrudOps, sessionId: string, ttlMs: number, key: Buffer,
): Result<string, AuthError> {
  const session = crud.sessionGet(db, sessionId)
  if (!session) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const ticket = crud.ticketGet(db, session.ticket_id)
  if (!ticket) return err({ kind: 'not_found', entity: 'ticket', id: session.ticket_id })
  return mintForTicket(db, crud, session, ticket, ttlMs, key)
}

function mintForTicket(
  db: Db, crud: AuthCrudOps,
  session: { id: string }, ticket: { id: string; project_id: string }, ttlMs: number, key: Buffer,
): Result<string, AuthError> {
  const project = crud.projectGet(db, ticket.project_id)
  if (!project) return err({ kind: 'not_found', entity: 'project', id: ticket.project_id })
  if (!project.owner_id) return err({ kind: 'internal', message: `project '${project.id}' has no owner — cannot mint sandbox token` })
  const exp = Math.floor((Date.now() + ttlMs) / 1000)
  return ok(sign({ v: 1, sid: session.id, tid: ticket.id, pid: project.id, aid: project.owner_id, exp }, key))
}

export function verify(token: string, key: Buffer): SessionClaims | null {
  if (!isSandboxToken(token)) return null
  const parsed = parseToken(token)
  if (!parsed) return null
  if (!verifySignature(parsed.payload, parsed.sigB64, key)) return null
  return parseClaims(parsed.payload)
}

function parseToken(token: string): { payload: string; sigB64: string } | null {
  const body = token.slice('sb_'.length)
  const dot  = body.indexOf('.')
  if (dot < 0) return null
  const payload = body.slice(0, dot)
  const sigB64  = body.slice(dot + 1)
  if (!payload || !sigB64) return null
  return { payload, sigB64 }
}

function verifySignature(payload: string, sigB64: string, key: Buffer): boolean {
  const expected = createHmac('sha256', key).update(payload).digest()
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

function sign(claims: SessionClaims, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url')
  const sig     = createHmac('sha256', key).update(payload).digest('base64url')
  return `sb_${payload}.${sig}`
}
