import { randomBytes } from 'crypto'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import type { Account } from '@foundry/db'
import type { Result, AuthError } from '@foundry/model'
import { ok, err } from '@foundry/model'
import type * as validate from './validators.js'
import type { AuthConfig, AuthCrudOps, GithubOAuthDeps, GithubOAuthUser } from './types.js'

export const AUTH_STATE_TTL_SEC = 60 * 10

export type AuthCallbackResult = { sessionId: string; expiresAt: Date; account: Account }

export function authStart(
  config: AuthConfig, baseUrl: string, deps: GithubOAuthDeps,
): { url: string; state: string } {
  const state = randomBytes(32).toString('hex')
  return { url: deps.oauthAuthorizeUrl(config, baseUrl, state), state }
}

export async function authCallback(
  db: Db, config: AuthConfig,
  input: z.infer<typeof validate.authCallback>,
  stateCookie: string | undefined,
  deps: GithubOAuthDeps, crud: AuthCrudOps,
): Promise<Result<AuthCallbackResult, AuthError>> {
  if (!stateCookie || stateCookie !== input.state) return err({ kind: 'validation_failed', field: 'state', reason: 'invalid oauth state' })
  const token = await deps.oauthExchangeCode(config, input.code)
  const user  = await deps.fetchUser(token)
  if (!isAllowed(config, user.login)) return err({ kind: 'forbidden', reason: 'account not authorized' })
  return ok(authCallbackPersist(db, config, user, crud))
}

function isAllowed(config: AuthConfig, login: string): boolean {
  const allowed = new Set<string>(config.allowedGithubLogins)
  if (config.ownerGitHubLogin) allowed.add(config.ownerGitHubLogin)
  return allowed.has(login)
}

function authCallbackPersist(db: Db, config: AuthConfig, user: GithubOAuthUser, crud: AuthCrudOps): AuthCallbackResult {
  const account = crud.accountUpsertByGithubId(db, user)
  const sessionId = randomBytes(32).toString('hex')
  const created = new Date()
  const expires = new Date(created.getTime() + config.sessionMaxAgeSec * 1000)
  insertAuthSession(db, crud, sessionId, account.id, created, expires)
  claimUnownedIfOwner(db, crud, config, account)
  return { sessionId, expiresAt: expires, account }
}

function insertAuthSession(
  db: Db, crud: AuthCrudOps, sessionId: string, accountId: string, created: Date, expires: Date,
): void {
  crud.authSessionInsert(db, {
    id: sessionId, account_id: accountId,
    created_at: created.toISOString(), expires_at: expires.toISOString(),
  })
}

function claimUnownedIfOwner(db: Db, crud: AuthCrudOps, config: AuthConfig, account: Account): void {
  if (!config.ownerGitHubLogin || account.login !== config.ownerGitHubLogin) return
  const claimed = crud.claimUnownedProjects(db, account.login)
  if (claimed > 0) console.log(`claimed ${claimed} unowned project(s) for ${account.login}`)
}

export function authMe(account: Account): { id: string; login: string; name: string | null; avatar_url: string | null } {
  return { id: account.id, login: account.login, name: account.name, avatar_url: account.avatar_url }
}

export function authLogout(db: Db, sessionId: string, crud: AuthCrudOps): Result<{ ok: true }, AuthError> {
  crud.authSessionRemove(db, sessionId)
  return ok({ ok: true })
}
