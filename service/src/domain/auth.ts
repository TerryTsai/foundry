import { randomBytes } from 'crypto'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Account } from '../tables.js'
import type { Config } from '../config.js'
import { badRequest, forbidden } from '../errors.js'
import * as validate from '../validate.js'
import * as github from '../connections/github.js'

export const AUTH_STATE_TTL_SEC = 60 * 10  // 10 min for the OAuth state cookie

export function authStart(config: Config, baseUrl: string): { url: string; state: string } {
  const state = randomBytes(32).toString('hex')
  return { url: github.oauthAuthorizeUrl(config, baseUrl, state), state }
}

export async function authCallback(
  db: Db,
  config: Config,
  input: z.infer<typeof validate.authCallback>,
  stateCookie: string | undefined,
): Promise<{ sessionId: string; expiresAt: Date; account: Account }> {
  if (!stateCookie || stateCookie !== input.state) throw badRequest('invalid oauth state')
  const token = await github.oauthExchangeCode(config, input.code)
  const user  = await github.fetchUser(token)

  // Effective allowlist = ALLOWED_GITHUB_LOGINS ∪ OWNER_GITHUB_LOGIN. Empty
  // means no one signs in. Fail-closed so a fresh deploy with neither var
  // set doesn't accept the whole internet.
  const allowed = new Set<string>(config.allowedGithubLogins)
  if (config.ownerGitHubLogin) allowed.add(config.ownerGitHubLogin)
  if (!allowed.has(user.login)) throw forbidden('account not authorized')

  const account = database.accountUpsertByGithubId(db, user)

  const sessionId = randomBytes(32).toString('hex')
  const created   = new Date()
  const expires   = new Date(created.getTime() + config.sessionMaxAgeSec * 1000)
  database.authSessionInsert(db, {
    id:         sessionId,
    account_id: account.id,
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
  })

  // First-time bootstrap: if this account matches OWNER_GITHUB_LOGIN, claim
  // any unowned projects. Idempotent — safe to run on every login.
  if (config.ownerGitHubLogin && account.login === config.ownerGitHubLogin) {
    const claimed = database.claimUnownedProjects(db, account.login)
    if (claimed > 0) console.log(`claimed ${claimed} unowned project(s) for ${account.login}`)
  }

  return { sessionId, expiresAt: expires, account }
}

export function authMe(account: Account): { id: string; login: string; name: string | null; avatar_url: string | null } {
  return { id: account.id, login: account.login, name: account.name, avatar_url: account.avatar_url }
}

export function authLogout(db: Db, sessionId: string): { ok: true } {
  database.authSessionRemove(db, sessionId)
  return { ok: true }
}
