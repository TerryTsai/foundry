import { describe, it, expect, beforeEach } from 'vitest'
import {
  accountUpsertByGithubId,
  accountGetById, sessionGetById, ticketGetById, projectGetById,
  authSessionGet, authSessionInsert, authSessionRemove,
  claimUnownedProjects,
  executionList as crudExecutionList,
  executionBySession as crudExecutionBySession,
  executionMeterCreate, executionMeterUpdate, executionMarkCancelled,
  sessionsForTicketRaw,
} from '@foundry/crud'
import type { Db, Account } from '@foundry/db'
import { makeCtx } from '@foundry/model'
import type { Ctx } from '@foundry/model'

import { bind } from '../src/bind.js'
import { createCrudAdapter }      from '../src/adapters/crud-inprocess.js'
import { createBillingAdapter }   from '../src/adapters/billing-inprocess.js'
import { createAnalyticsAdapter } from '../src/adapters/analytics-inprocess.js'
import { createSandboxAdapter }   from '../src/adapters/sandbox-inprocess.js'
import { createMcpAdapter }       from '../src/adapters/mcp-inprocess.js'
import { createAuthAdapter }      from '../src/adapters/auth-inprocess.js'
import { createEngineAdapter }    from '../src/adapters/engine-inprocess.js'
import { createReconcilerAdapter } from '../src/adapters/reconciler-inprocess.js'
import { createInProcessClient } from '../src/adapters/in-process.js'

import { makeTestDb } from './helpers/test-db.js'

let db: Db
let ctx: Ctx
let account: Account

beforeEach(() => {
  db = makeTestDb()
  account = accountUpsertByGithubId(db, {
    github_id: 1, login: 'tester', name: 'Tester', email: null, avatar_url: null,
  })
  ctx = makeCtx({ accountId: account.id })
})

const stubProviderGet = (_kind: string) => undefined
const stubSupportedKinds = () => [] as string[]

describe('crud adapter', () => {
  it('returns ok Result on happy path', async () => {
    const c = createCrudAdapter({ db, providerGet: stubProviderGet, supportedKinds: stubSupportedKinds })
    const bound = bind(createInProcessClient(emptyAdapters({ crud: c })), ctx)

    const created = await bound.crud.projectCreate({ name: 'p1', repo: 'o/r' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const list = await bound.crud.projectList({})
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value.length).toBe(1)
  })

  it('returns err Result for not_found (404)', async () => {
    const c = createCrudAdapter({ db, providerGet: stubProviderGet, supportedKinds: stubSupportedKinds })
    const bound = bind(createInProcessClient(emptyAdapters({ crud: c })), ctx)

    const r = await bound.crud.projectGet('missing-id')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })
})

describe('billing adapter', () => {
  it('returns ok with unlimited quota', async () => {
    const b = createBillingAdapter()
    const bound = bind(createInProcessClient(emptyAdapters({ billing: b })), ctx)

    const r = await bound.billing.quotaCheck('sessions_concurrent')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.allowed).toBe(true)
  })

  it('returns ok on quotaConsume too (stubbed)', async () => {
    const b = createBillingAdapter()
    const bound = bind(createInProcessClient(emptyAdapters({ billing: b })), ctx)
    const r = await bound.billing.quotaConsume('tokens_monthly', 100)
    expect(r.ok).toBe(true)
  })
})

describe('analytics adapter', () => {
  it('returns ok with empty aggregate when no data', async () => {
    const a = createAnalyticsAdapter({ db })
    const bound = bind(createInProcessClient(emptyAdapters({ analytics: a })), ctx)

    const r = await bound.analytics.analytics({ days: 30 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.daily).toEqual([])

    const tags = await bound.analytics.tagsList()
    expect(tags.ok).toBe(true)
  })

  it('returns err Result when target id is missing', async () => {
    const a = createAnalyticsAdapter({ db })
    const bound = bind(createInProcessClient(emptyAdapters({ analytics: a })), ctx)

    const r = await bound.analytics.ticketUsage('missing')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })
})

describe('sandbox adapter', () => {
  const sandboxConfig = {
    sandboxImage: 'busybox', sandboxMemoryMb: 256, sandboxCpus: 1,
    sandboxPidsLimit: 64, sandboxNofileSoft: 1024, sandboxNofileHard: 2048,
    sandboxTmpfsMb: 64, sandboxTimeout: 1000,
  }
  const stubExecOwn = (_d: Db, _id: string, _a: string) =>
    ({ ok: false as const, error: { kind: 'not_found' as const, entity: 'execution', id: _id } })
  const stubSessOwn = (_d: Db, _id: string, _a: string) =>
    ({ ok: false as const, error: { kind: 'not_found' as const, entity: 'session', id: _id } })

  const sandboxCrud = {
    sessionGetById,
    executionList: crudExecutionList,
    executionBySession: crudExecutionBySession,
    sessionsForTicketRaw,
    executionMeterCreate,
    executionMeterUpdate,
    executionMarkCancelled,
  }

  it('executionList returns ok with empty list when account has nothing', async () => {
    const s = createSandboxAdapter({ db, config: sandboxConfig, executionOwned: stubExecOwn, sessionOwned: stubSessOwn, sandboxCrud })
    const bound = bind(createInProcessClient(emptyAdapters({ sandbox: s })), ctx)
    const r = await bound.sandbox.executionList()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })

  it('executionGet returns err Result on missing execution', async () => {
    const s = createSandboxAdapter({ db, config: sandboxConfig, executionOwned: stubExecOwn, sessionOwned: stubSessOwn, sandboxCrud })
    const bound = bind(createInProcessClient(emptyAdapters({ sandbox: s })), ctx)
    const r = await bound.sandbox.executionGet('nonexistent')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })
})

describe('mcp adapter', () => {
  it('agentMcpList returns ok with built-in registry entries', async () => {
    const m = createMcpAdapter({ db })
    const bound = bind(createInProcessClient(emptyAdapters({ mcp: m })), ctx)
    const r = await bound.mcp.agentMcpList()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBeGreaterThan(0)
  })

  it('agentMcpList still ok when account has no connections', async () => {
    const m = createMcpAdapter({ db })
    const stranger = makeCtx({ accountId: 'a_unknown' })
    const bound = bind(createInProcessClient(emptyAdapters({ mcp: m })), stranger)
    const r = await bound.mcp.agentMcpList()
    // Built-in tools come back regardless of account; this is a happy path.
    expect(r.ok).toBe(true)
  })
})

describe('auth adapter', () => {
  const authConfig = {
    gitHubClientId: 'cid', gitHubClientSecret: 'csec',
    ownerGitHubLogin: 'tester',
    allowedGithubLogins: ['tester'],
    cookieSecure: false, sessionMaxAgeSec: 3600,
    internalApiToken: 'tok',
  }
  const githubDeps = {
    oauthAuthorizeUrl: (_c: any, baseUrl: string, state: string) => `${baseUrl}/auth?state=${state}`,
    oauthExchangeCode: async (_c: any, _code: string) => 'gh-token',
    fetchUser:         async (_t: string) => ({
      github_id: 1, login: 'tester', name: 'Tester', email: null, avatar_url: null,
    }),
  }

  const authCrud = {
    accountGet: accountGetById,
    accountUpsertByGithubId,
    authSessionGet, authSessionInsert, authSessionRemove,
    claimUnownedProjects,
    sessionGet: sessionGetById,
    ticketGet:  ticketGetById,
    projectGet: projectGetById,
  }

  it('authStart returns ok with url + state', async () => {
    const a = createAuthAdapter({ db, config: authConfig, githubDeps, authCrud })
    const bound = bind(createInProcessClient(emptyAdapters({ auth: a })), ctx)
    const r = await bound.auth.authStart({ baseUrl: 'http://localhost' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.url).toContain('state=')
  })

  it('authCallback returns err Result on bad oauth state', async () => {
    const a = createAuthAdapter({ db, config: authConfig, githubDeps, authCrud })
    const bound = bind(createInProcessClient(emptyAdapters({ auth: a })), ctx)
    const r = await bound.auth.authCallback({
      code: 'x', state: 'mismatch', stateCookie: 'something-else',
    })
    expect(r.ok).toBe(false)
    // 400 → internal in toAuthError; either way must be err Result
    if (!r.ok) expect(typeof r.error.kind).toBe('string')
  })
})

describe('engine adapter', () => {
  const engineConfig = {
    sandboxTimeout: 1000, port: 0,
    sandboxImage: 'busybox', sandboxMemoryMb: 256, sandboxCpus: 1,
    sandboxPidsLimit: 64, sandboxNofileSoft: 1024, sandboxNofileHard: 2048,
    sandboxTmpfsMb: 64, internalApiToken: 'tok',
  }
  const engineDeps = { auth: {}, mcp: {}, sandbox: {}, crud: {} } as any

  it('runSession returns err Result when agent missing', async () => {
    const e = createEngineAdapter({ db, config: engineConfig, engineDeps })
    const bound = bind(createInProcessClient(emptyAdapters({ engine: e })), ctx)
    const r = await bound.engine.runSession({
      sessionId: 's', agentId: 'missing', ticketId: 't', role: 'producer',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })

  // Happy path on engine.runSession is integration-heavy (LLM, podman). The
  // not-found path proves the adapter's wrap+error-translation works; the
  // engine itself has its own tests.
  it('runSession adapter is callable through bound client', async () => {
    const e = createEngineAdapter({ db, config: engineConfig, engineDeps })
    const bound = bind(createInProcessClient(emptyAdapters({ engine: e })), ctx)
    expect(typeof bound.engine.runSession).toBe('function')
  })
})

describe('reconciler adapter', () => {
  // Reconciler slice is intentionally empty — bound client exposes a slice
  // proxy that returns undefined for any method lookup.
  it('returns an empty slice', async () => {
    const r = createReconcilerAdapter()
    const bound = bind(createInProcessClient(emptyAdapters({ reconciler: r })), ctx)
    expect(bound.reconciler).toBeDefined()
  })

  it('any method lookup yields undefined', () => {
    const r = createReconcilerAdapter()
    const bound = bind(createInProcessClient(emptyAdapters({ reconciler: r })), ctx)
    const sliceUnknown = bound.reconciler as Record<string, unknown>
    expect(sliceUnknown.tick).toBeUndefined()
  })
})

// Build a full InProcessAdapters bag with empties everywhere except the
// slice under test. Keeps each test tightly scoped.
function emptyAdapters(overrides: Partial<{
  auth: ReturnType<typeof createAuthAdapter>
  billing: ReturnType<typeof createBillingAdapter>
  crud: ReturnType<typeof createCrudAdapter>
  analytics: ReturnType<typeof createAnalyticsAdapter>
  sandbox: ReturnType<typeof createSandboxAdapter>
  mcp: ReturnType<typeof createMcpAdapter>
  engine: ReturnType<typeof createEngineAdapter>
  reconciler: ReturnType<typeof createReconcilerAdapter>
}>) {
  return {
    auth:       overrides.auth       ?? ({} as any),
    billing:    overrides.billing    ?? ({} as any),
    crud:       overrides.crud       ?? ({} as any),
    analytics:  overrides.analytics  ?? ({} as any),
    sandbox:    overrides.sandbox    ?? ({} as any),
    mcp:        overrides.mcp        ?? ({} as any),
    engine:     overrides.engine     ?? ({} as any),
    reconciler: overrides.reconciler ?? ({} as any),
  }
}
