import { randomBytes } from 'crypto'

import type { Account } from '@foundry/db'
import type { Result, Ctx } from '@foundry/model'
import { ok, err } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'

import type {
  AuthConfig, GithubOAuthUser,
  AuthCallbackResult, OauthCallbackQuery, AuthError,
} from './schema.js'

export function authStart(
  config: AuthConfig, baseUrl: string,
  oauthAuthorizeUrl: (config: AuthConfig, baseUrl: string, state: string) => string,
): { url: string; state: string } {
  const state = randomBytes(32).toString('hex')
  return { url: oauthAuthorizeUrl(config, baseUrl, state), state }
}

export async function authCallback(
  ctx: Ctx, config: AuthConfig,
  input: OauthCallbackQuery,
  stateCookie: string | undefined,
  oauthExchangeCode: (config: AuthConfig, code: string) => Promise<string>,
  fetchUser: (token: string) => Promise<GithubOAuthUser>,
  crud: CrudClient,
): Promise<Result<AuthCallbackResult, AuthError>> {
  if (!stateCookie || stateCookie !== input.state) return err({ kind: 'validation_failed', field: 'state', reason: 'invalid oauth state' })
  const token = await oauthExchangeCode(config, input.code)
  const user  = await fetchUser(token)
  if (!isAllowed(config, user.login)) return err({ kind: 'forbidden', reason: 'account not authorized' })
  return ok(await authCallbackPersist(ctx, config, user, crud))
}

function isAllowed(config: AuthConfig, login: string): boolean {
  const allowed = new Set<string>(config.allowedGithubLogins)
  if (config.ownerGitHubLogin) allowed.add(config.ownerGitHubLogin)
  return allowed.has(login)
}

async function authCallbackPersist(
  ctx: Ctx, config: AuthConfig, user: GithubOAuthUser, crud: CrudClient,
): Promise<AuthCallbackResult> {
  const accR = await crud.accountUpsertByGithubId(ctx, user)
  if (!accR.ok) throw new Error(`accountUpsertByGithubId: ${accR.error.kind}`)
  const account = accR.value
  const sessionId = randomBytes(32).toString('hex')
  const created = new Date()
  const expires = new Date(created.getTime() + config.sessionMaxAgeSec * 1000)
  await crud.authSessionInsert(ctx, {
    id: sessionId, account_id: account.id,
    created_at: created.toISOString(), expires_at: expires.toISOString(),
  })
  await claimUnownedIfOwner(ctx, crud, config, account)
  return { sessionId, expiresAt: expires, account }
}

async function claimUnownedIfOwner(ctx: Ctx, crud: CrudClient, config: AuthConfig, account: Account): Promise<void> {
  if (!config.ownerGitHubLogin || account.login !== config.ownerGitHubLogin) return
  const r = await crud.claimUnownedProjects(ctx, account.login)
  if (r.ok && r.value > 0) console.log(`claimed ${r.value} unowned project(s) for ${account.login}`)
}

export function authMe(account: Account): { id: string; login: string; name: string | null; avatar_url: string | null } {
  return { id: account.id, login: account.login, name: account.name, avatar_url: account.avatar_url }
}

export async function authLogout(
  ctx: Ctx, sessionId: string, crud: CrudClient,
): Promise<Result<{ ok: true }, AuthError>> {
  await crud.authSessionRemove(ctx, sessionId)
  return ok({ ok: true })
}
