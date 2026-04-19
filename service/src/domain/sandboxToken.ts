import { type Db } from '../database.js'
import * as database from '../database.js'
import { mustExist } from '../util.js'
import {
  signSessionJwt,
  verifySessionJwt,
  isSessionJwt,
  type SessionClaims,
} from '../crypto/jwt.js'

// Per-session sandbox auth. Stateless JWT — no table, no lookup. Claims
// carry session → ticket → project → account so requireAuth can populate
// req.account directly from the signed payload.
//
// The sandbox receives the token via a mounted file (/foundry-secrets/token)
// and sends it as `Authorization: Bearer <token>`. Signature is HMAC-SHA256
// over the claims using FOUNDRY_ENCRYPTION_KEY.

const DEFAULT_TTL_MS = 30 * 60 * 1000  // 30 min; sandbox timeout default is 20

export { isSessionJwt as isSandboxToken }

export function mint(db: Db, sessionId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const session = mustExist(database.sessionGet(db, sessionId), `session '${sessionId}' not found`)
  const ticket  = mustExist(database.ticketGet(db, session.ticket_id), `ticket '${session.ticket_id}' not found`)
  const project = mustExist(database.projectGet(db, ticket.project_id), `project '${ticket.project_id}' not found`)
  if (!project.owner_id) throw new Error(`project '${project.id}' has no owner — cannot mint sandbox token`)
  const claims: SessionClaims = {
    v:   1,
    sid: session.id,
    tid: ticket.id,
    pid: project.id,
    aid: project.owner_id,
    exp: Math.floor((Date.now() + ttlMs) / 1000),
  }
  return signSessionJwt(claims)
}

export function resolve(_db: Db, token: string): SessionClaims | undefined {
  return verifySessionJwt(token) ?? undefined
}
