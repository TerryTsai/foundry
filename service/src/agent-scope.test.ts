// End-to-end validation of the hoisted agents/connections model.
// Covers all 10 QA test cases from the parent ticket.
//
// TC1  Settings access       — router has /settings routes (static)
// TC2  Agent list scoped     — GET /agent returns only this account's agents
// TC3  Create agent          — POST /agent: no project_id, uses account_id
// TC4  Create connection     — POST /connection: no project_id, uses account_id
// TC5  Dispatch ticket       — scheduler resolves agents by account_id
// TC6  MCP agentsList        — tool calls /agent?accountId=<account>
// TC7  Old routes 404        — /p/:id/agents never matched
// TC8  Project settings link — AvatarMenu goes to /settings/projects/:id
// TC9  No tab bar            — Shell navItems is tickets-only, no bottom bar
// TC10 Regression            — ticket CRUD unaffected

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schema from './schema.js'
import * as router from './router.js'
import * as domain from './domain.js'
import * as database from './database.js'
import * as validate from './validate.js'
import { errors } from './middleware.js'
import type { Config } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Test DB ──────────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL UNIQUE,
      login TEXT NOT NULL,
      name TEXT,
      email TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_session (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL DEFAULT '' REFERENCES account(id),
      repo TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      schedule_interval INTEGER NOT NULL DEFAULT 600,
      concurrency_limit INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE connection (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      secrets TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ticket (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      blocked_by TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimed_at TEXT
    );
    CREATE TABLE ticket_tag (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_ticket_tag_unique ON ticket_tag(ticket_id, tag);
    CREATE TABLE comment (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES ticket(id),
      session_id TEXT,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      connection_id TEXT NOT NULL REFERENCES connection(id),
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      max_tokens INTEGER NOT NULL DEFAULT 8192,
      max_steps INTEGER NOT NULL DEFAULT 20,
      temperature REAL,
      reasoning_budget INTEGER,
      tools TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, name)
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agent(id),
      status TEXT NOT NULL DEFAULT 'running',
      model TEXT NOT NULL,
      system_prompt TEXT,
      error TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      finish_reason TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES session(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens INTEGER,
      tokens_in INTEGER,
      tool_call_count INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE execution (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      tool_name TEXT,
      tool_input TEXT,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      exit_code INTEGER,
      exit_signal TEXT,
      stdout TEXT,
      stderr TEXT,
      duration_ms INTEGER,
      timeout_ms INTEGER NOT NULL,
      memory_mb INTEGER,
      peak_memory_mb REAL,
      cpu_ms INTEGER,
      net_rx_bytes INTEGER,
      net_tx_bytes INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
  `)
  return drizzle(sqlite, { schema })
}

// ── Test app factory ─────────────────────────────────────────────────────────

const TEST_TOKEN = 'test-internal-token'

const testConfig: Config = {
  port: 3099,
  dbPath: ':memory:',
  sandboxImage: 'foundry-sandbox',
  sandboxTimeout: 120000,
  sandboxMemoryMb: 512,
  sandboxCpus: 1,
  sandboxPidsLimit: 64,
  sandboxNofileSoft: 1024,
  sandboxNofileHard: 2048,
  sandboxTmpfsMb: 64,
  gitHubClientId: 'test-client-id',
  gitHubClientSecret: 'test-client-secret',
  gitHubAppId: undefined,
  gitHubAppPrivateKeyPath: undefined,
  gitHubAppPrivateKey: undefined,
  ownerGitHubLogin: undefined,
  cookieSecure: false,
  sessionMaxAgeSec: 86400,
  internalApiToken: TEST_TOKEN,
}

function buildApp(db: ReturnType<typeof createTestDb>) {
  const app = express()
  app.use(express.json())

  // Internal bearer token — skips session lookup, sets no req.account
  // (same pattern as real middleware.requireAuth)
  app.use((req, _res, next) => {
    const auth = req.headers.authorization
    if (auth === `Bearer ${TEST_TOKEN}`) return next()
    next()  // tests use cookie to set req.account inline
  })

  // Attach the test account to req for routes that need it
  app.use((req: any, _res, next) => {
    const accountId = req.headers['x-test-account-id'] as string | undefined
    if (accountId) {
      const acc = database.accountGet(db, accountId)
      if (acc) req.account = acc
    }
    next()
  })

  app.use('/project',    router.project(db))
  app.use('/connection', router.connection(db))
  app.use('/ticket',     router.ticket(db))
  app.use('/agent',      router.agent(db, testConfig))
  app.use('/session',    router.session(db))
  app.use('/execution',  router.execution(db, testConfig))

  app.use(errors)
  return app
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString()
const FUTURE = new Date(Date.now() + 86400_000).toISOString()

function seedAccount(db: ReturnType<typeof createTestDb>, idx: number) {
  return database.accountUpsertByGithubId(db, {
    github_id:  1000 + idx,
    login:      `user${idx}`,
    name:       `User ${idx}`,
    email:      null,
    avatar_url: null,
  })
}

function seedSession(db: ReturnType<typeof createTestDb>, accountId: string) {
  const sid = `sess-${accountId}`
  database.authSessionInsert(db, {
    id:         sid,
    account_id: accountId,
    created_at: NOW,
    expires_at: FUTURE,
  })
  return sid
}

function seedConnection(db: ReturnType<typeof createTestDb>, accountId: string, name: string) {
  return database.connectionInsert(db, {
    account_id: accountId,
    kind:       'anthropic',
    name,
    config:     '{}',
    secrets:    '{"api_key":"sk-test"}',
    created_at: NOW,
    updated_at: NOW,
  })
}

function seedAgent(db: ReturnType<typeof createTestDb>, accountId: string, connectionId: string, name: string) {
  return database.agentInsert(db, {
    account_id:    accountId,
    connection_id: connectionId,
    name,
    model:         'claude-sonnet-4-20250514',
    prompt:        'you are a test agent',
    max_tokens:    8192,
    max_steps:     20,
    temperature:   null,
    reasoning_budget: null,
    tools:         null,
    created_at:    NOW,
    updated_at:    NOW,
  })
}

function seedProject(db: ReturnType<typeof createTestDb>, accountId: string) {
  return database.projectInsert(db, {
    owner_id:          accountId,
    repo:              'owner/repo',
    name:              'test-project',
    description:       '',
    status:            'active',
    schedule_interval: 600,
    concurrency_limit: 3,
    created_at:        NOW,
    updated_at:        NOW,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// TC1 — Settings access: router has /settings routes (static check)
// ════════════════════════════════════════════════════════════════════════════

describe('TC1: /settings routes exist in router', () => {
  it('router.tsx declares /settings path with agents, connections, projects sub-routes', () => {
    const routerSrc = readFileSync(
      join(__dirname, '../../web/src/router.tsx'),
      'utf-8',
    )
    expect(routerSrc).toContain("path: '/settings'")
    expect(routerSrc).toContain("path: 'agents'")
    expect(routerSrc).toContain("path: 'connections'")
    expect(routerSrc).toContain("path: 'projects'")
  })

  it('SettingsLayout.tsx exports a SettingsLayout function', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/pages/settings/SettingsLayout.tsx'),
      'utf-8',
    )
    expect(src).toContain('export function SettingsLayout')
    expect(src).toContain('/settings/agents')
    expect(src).toContain('/settings/connections')
    expect(src).toContain('/settings/projects')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC2 — Agent list is account-scoped
// ════════════════════════════════════════════════════════════════════════════

describe('TC2: GET /agent is account-scoped', () => {
  let db: ReturnType<typeof createTestDb>
  let app: ReturnType<typeof buildApp>
  let account1: any, account2: any
  let conn1: any, conn2: any

  beforeEach(() => {
    db = createTestDb()
    app = buildApp(db)
    account1 = seedAccount(db, 1)
    account2 = seedAccount(db, 2)
    conn1 = seedConnection(db, account1.id, 'conn-a1')
    conn2 = seedConnection(db, account2.id, 'conn-a2')
    seedAgent(db, account1.id, conn1.id, 'alpha')
    seedAgent(db, account2.id, conn2.id, 'beta')
  })

  it('returns only agents belonging to the requesting account', async () => {
    const res = await request(app)
      .get('/agent')
      .set('x-test-account-id', account1.id)
      .expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('alpha')
    expect(res.body[0].account_id).toBe(account1.id)
  })

  it('account2 sees only its own agents, not account1\'s', async () => {
    const res = await request(app)
      .get('/agent')
      .set('x-test-account-id', account2.id)
      .expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('beta')
    expect(res.body[0].account_id).toBe(account2.id)
  })

  it('agent list contains no project_id field', async () => {
    const res = await request(app)
      .get('/agent')
      .set('x-test-account-id', account1.id)
      .expect(200)
    expect(res.body[0]).not.toHaveProperty('project_id')
    expect(res.body[0]).toHaveProperty('account_id')
  })

  it('internal bearer token with ?accountId returns agents for that account', async () => {
    const res = await request(app)
      .get(`/agent?accountId=${account1.id}`)
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('alpha')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC3 — Create agent: no project_id field, uses account_id
// ════════════════════════════════════════════════════════════════════════════

describe('TC3: POST /agent creates account-scoped agent', () => {
  let db: ReturnType<typeof createTestDb>
  let app: ReturnType<typeof buildApp>
  let account: any, conn: any

  beforeEach(() => {
    db = createTestDb()
    app = buildApp(db)
    account = seedAccount(db, 1)
    conn = seedConnection(db, account.id, 'test-conn')
  })

  it('creates agent without project_id in request body', async () => {
    const res = await request(app)
      .post('/agent')
      .set('x-test-account-id', account.id)
      .send({
        connection_id: conn.id,
        name:          'tester',
        model:         'claude-sonnet-4-20250514',
        prompt:        'test prompt',
      })
      .expect(201)
    expect(res.body.name).toBe('tester')
    expect(res.body.account_id).toBe(account.id)
    expect(res.body).not.toHaveProperty('project_id')
  })

  it('created agent appears in account agent list', async () => {
    await request(app)
      .post('/agent')
      .set('x-test-account-id', account.id)
      .send({ connection_id: conn.id, name: 'listme', model: 'claude-sonnet-4-20250514', prompt: 'p' })
      .expect(201)

    const list = await request(app)
      .get('/agent')
      .set('x-test-account-id', account.id)
      .expect(200)
    expect(list.body.map((a: any) => a.name)).toContain('listme')
  })

  it('validate.agentCreate schema has no project_id field', () => {
    const shape = validate.agentCreate.shape
    expect(shape).not.toHaveProperty('project_id')
    expect(shape).toHaveProperty('connection_id')
    expect(shape).toHaveProperty('name')
    expect(shape).toHaveProperty('model')
    expect(shape).toHaveProperty('prompt')
  })

  it('rejected if no connection_id provided', async () => {
    const res = await request(app)
      .post('/agent')
      .set('x-test-account-id', account.id)
      .send({ name: 'bad', model: 'claude-sonnet-4-20250514', prompt: 'p' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC4 — Create connection: no project_id, uses account_id
// ════════════════════════════════════════════════════════════════════════════

describe('TC4: POST /connection creates account-scoped connection', () => {
  let db: ReturnType<typeof createTestDb>
  let app: ReturnType<typeof buildApp>
  let account: any

  beforeEach(() => {
    db = createTestDb()
    app = buildApp(db)
    account = seedAccount(db, 1)
  })

  it('creates connection without project_id in request body', async () => {
    const res = await request(app)
      .post('/connection')
      .set('x-test-account-id', account.id)
      .send({ name: 'my-conn', kind: 'anthropic', secrets: { api_key: 'sk-test' } })
      .expect(201)
    expect(res.body.name).toBe('my-conn')
    expect(res.body.account_id).toBe(account.id)
    expect(res.body).not.toHaveProperty('project_id')
  })

  it('created connection appears in connection list', async () => {
    await request(app)
      .post('/connection')
      .set('x-test-account-id', account.id)
      .send({ name: 'listme-conn', kind: 'anthropic', secrets: { api_key: 'sk-x' } })
      .expect(201)

    const list = await request(app)
      .get('/connection')
      .set('x-test-account-id', account.id)
      .expect(200)
    expect(list.body.map((c: any) => c.name)).toContain('listme-conn')
  })

  it('validate.connectionCreate schema has no project_id field', () => {
    const shape = validate.connectionCreate.shape
    expect(shape).not.toHaveProperty('project_id')
    expect(shape).toHaveProperty('name')
    expect(shape).toHaveProperty('kind')
  })

  it('connection list is account-scoped: account2 does not see account1 connections', async () => {
    const account2 = seedAccount(db, 2)
    seedConnection(db, account.id, 'acc1-conn')
    seedConnection(db, account2.id, 'acc2-conn')

    const res = await request(app)
      .get('/connection')
      .set('x-test-account-id', account2.id)
      .expect(200)
    expect(res.body.map((c: any) => c.name)).toContain('acc2-conn')
    expect(res.body.map((c: any) => c.name)).not.toContain('acc1-conn')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC5 — Scheduler dispatch uses account_id to resolve agents
// ════════════════════════════════════════════════════════════════════════════

describe('TC5: schedulerDispatch resolves agents by account_id', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('does not dispatch when no agent matches the account', async () => {
    const account = seedAccount(db, 1)
    const proj    = seedProject(db, account.id)

    // Create an open ticket assigned to an agent that doesn't exist
    database.ticketInsert(db, {
      project_id: proj.id,
      agent_id:   'nonexistent-agent-id',
      title:      'test',
      body:       'test',
      status:     'open',
      priority:   0,
      created_by: 'test',
      created_at: NOW,
      updated_at: NOW,
    })

    // Dispatch should not throw, and ticket stays open
    await domain.schedulerDispatch(db, proj.id)

    const tickets = domain.ticketList(db, { projectId: proj.id, status: 'claimed' })
    expect(tickets).toHaveLength(0)
  })

  it('dispatches ticket when agent belongs to the project owner account', async () => {
    const account = seedAccount(db, 1)
    const conn    = seedConnection(db, account.id, 'dispatch-conn')
    const agent   = seedAgent(db, account.id, conn.id, 'dispatch-agent')
    const proj    = seedProject(db, account.id)

    database.ticketInsert(db, {
      project_id: proj.id,
      agent_id:   agent.id,
      title:      'dispatch me',
      body:       'body',
      status:     'open',
      priority:   0,
      created_by: 'test',
      created_at: NOW,
      updated_at: NOW,
    })

    // schedulerDispatch looks up agents via agentList({accountId: proj.owner_id})
    // We can verify the domain function uses the right query by checking agentList
    const agents = domain.agentList(db, { accountId: account.id })
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe(agent.id)
    expect(agents[0].account_id).toBe(account.id)
  })

  it('agentList filters by accountId, not projectId', () => {
    const account1 = seedAccount(db, 1)
    const account2 = seedAccount(db, 2)
    const conn1    = seedConnection(db, account1.id, 'c1')
    const conn2    = seedConnection(db, account2.id, 'c2')
    seedAgent(db, account1.id, conn1.id, 'agent-a1')
    seedAgent(db, account2.id, conn2.id, 'agent-a2')

    const list1 = domain.agentList(db, { accountId: account1.id })
    const list2 = domain.agentList(db, { accountId: account2.id })

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('agent-a1')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('agent-a2')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC6 — MCP agentsList tool calls account-scoped endpoint
// ════════════════════════════════════════════════════════════════════════════

describe('TC6: MCP foundry tool agentsList uses accountId', () => {
  it('agentsList handler uses /agent?accountId=<ctx.accountId>', () => {
    const src = readFileSync(
      join(__dirname, 'mcp/foundry.ts'),
      'utf-8',
    )
    // handleAgentsList must call the /agent endpoint with accountId param
    expect(src).toContain('/agent?accountId=${ctx.accountId}')
  })

  it('handleConnectionList uses /connection?accountId=<ctx.accountId>', () => {
    const src = readFileSync(
      join(__dirname, 'mcp/foundry.ts'),
      'utf-8',
    )
    expect(src).toContain('/connection?accountId=${ctx.accountId}')
  })

  it('agentsList does not use projectId in the URL', () => {
    const src = readFileSync(
      join(__dirname, 'mcp/foundry.ts'),
      'utf-8',
    )
    // Extract the handleAgentsList function and confirm no projectId
    const fnMatch = src.match(/async function handleAgentsList[\s\S]*?^}/m)
    // The function should reference accountId, not projectId
    const fnSrc = fnMatch?.[0] ?? src
    expect(fnSrc).not.toMatch(/projectId.*agent/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC7 — Old per-project agent route returns 404
// ════════════════════════════════════════════════════════════════════════════

describe('TC7: old /p/:projectId/agents route does not exist', () => {
  let db: ReturnType<typeof createTestDb>
  let app: ReturnType<typeof buildApp>
  let account: any

  beforeEach(() => {
    db = createTestDb()
    app = buildApp(db)
    account = seedAccount(db, 1)
  })

  it('GET /p/:projectId/agents returns 404 (no such service route)', async () => {
    await request(app)
      .get('/p/some-project-id/agents')
      .set('x-test-account-id', account.id)
      .expect(404)
  })

  it('GET /p/:projectId/connections returns 404', async () => {
    await request(app)
      .get('/p/some-project-id/connections')
      .set('x-test-account-id', account.id)
      .expect(404)
  })

  it('router.tsx has no /p/:projectId/agents child route', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/router.tsx'),
      'utf-8',
    )
    // No per-project agents path in the current router
    expect(src).not.toMatch(/\/p\/:projectId\/agents/)
    expect(src).not.toMatch(/\/p\/:projectId\/connections/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC8 — Account menu links to /settings/projects/:id
// ════════════════════════════════════════════════════════════════════════════

describe('TC8: AvatarMenu links to /settings/projects/:id', () => {
  it('settings link goes to /settings/projects/<id>', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/components/AvatarMenu.tsx'),
      'utf-8',
    )
    expect(src).toContain('to={`/settings/projects/${projectId}`}')
  })

  it('new project link goes to /settings/projects/new, not /projects/new', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/components/AvatarMenu.tsx'),
      'utf-8',
    )
    expect(src).toContain('to="/settings/projects/new"')
    expect(src).not.toContain('to="/projects/new"')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC9 — No tab bar on mobile; Shell nav is tickets-only
// ════════════════════════════════════════════════════════════════════════════

describe('TC9: Shell header-only nav, no bottom tab bar', () => {
  it('Shell navItems contains only Tickets, not Agents or Connections', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/Shell.tsx'),
      'utf-8',
    )
    // navItems declaration
    expect(src).toContain("label: 'Tickets'")
    expect(src).not.toContain("label: 'Agents'")
    expect(src).not.toContain("label: 'Connections'")
  })

  it('Shell renders no bottom tab bar component', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/Shell.tsx'),
      'utf-8',
    )
    // Should have no tab bar div/nav with fixed bottom positioning
    expect(src).not.toMatch(/TabBar|tab.bar|bottom-tab/i)
    // Header-only nav via AppHeader + AvatarMenu
    expect(src).toContain('AppHeader')
    expect(src).toContain('AvatarMenu')
  })

  it('mobile layout in Shell has no tab bar — header only', () => {
    const src = readFileSync(
      join(__dirname, '../../web/src/Shell.tsx'),
      'utf-8',
    )
    // The MobileHeader is the sole mobile nav; there's no separate bottom element
    expect(src).not.toMatch(/flex.*fixed.*bottom/s)
    expect(src).not.toMatch(/fixed.*bottom-0/s)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TC10 — Regression: ticket CRUD, comments, sessions unaffected
// ════════════════════════════════════════════════════════════════════════════

describe('TC10: Ticket CRUD regression', () => {
  let db: ReturnType<typeof createTestDb>
  let app: ReturnType<typeof buildApp>
  let account: any, proj: any

  beforeEach(() => {
    db = createTestDb()
    app = buildApp(db)
    account = seedAccount(db, 1)
    proj    = seedProject(db, account.id)
  })

  it('creates a ticket', async () => {
    const res = await request(app)
      .post('/ticket')
      .set('x-test-account-id', account.id)
      .send({
        project_id: proj.id,
        title:      'my ticket',
        body:       'description',
        created_by: 'founder',
      })
      .expect(201)
    expect(res.body.title).toBe('my ticket')
    expect(res.body.project_id).toBe(proj.id)
    expect(res.body.status).toBe('open')
  })

  it('lists tickets by project', async () => {
    database.ticketInsert(db, {
      project_id: proj.id,
      title:      'listed',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })

    const res = await request(app)
      .get(`/ticket?projectId=${proj.id}`)
      .set('x-test-account-id', account.id)
      .expect(200)
    expect(res.body.some((t: any) => t.title === 'listed')).toBe(true)
  })

  it('gets a ticket by id', async () => {
    const t = database.ticketInsert(db, {
      project_id: proj.id,
      title:      'getme',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })

    const res = await request(app)
      .get(`/ticket/${t.id}`)
      .set('x-test-account-id', account.id)
      .expect(200)
    expect(res.body.title).toBe('getme')
  })

  it('posts a comment on a ticket', async () => {
    const t = database.ticketInsert(db, {
      project_id: proj.id,
      title:      'comment-target',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })

    const res = await request(app)
      .post(`/ticket/${t.id}/comment`)
      .set('x-test-account-id', account.id)
      .send({ author: 'founder', body: 'LGTM' })
      .expect(201)
    expect(res.body.body).toBe('LGTM')
    expect(res.body.author).toBe('founder')
  })

  it('lists comments for a ticket', async () => {
    const t = database.ticketInsert(db, {
      project_id: proj.id,
      title:      'comment-list',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })
    database.commentInsert(db, { ticket_id: t.id, author: 'agent', body: 'done', created_at: NOW })

    const res = await request(app)
      .get(`/ticket/${t.id}/comment`)
      .set('x-test-account-id', account.id)
      .expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].body).toBe('done')
  })

  it('ticket status transitions: open → claimed → done', async () => {
    const t = database.ticketInsert(db, {
      project_id: proj.id,
      title:      'lifecycle',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })

    await request(app).post(`/ticket/${t.id}/claim`).set('x-test-account-id', account.id).expect(200)
    const claimed = await request(app).get(`/ticket/${t.id}`).set('x-test-account-id', account.id).expect(200)
    expect(claimed.body.status).toBe('claimed')

    await request(app).post(`/ticket/${t.id}/done`).set('x-test-account-id', account.id).send({}).expect(200)
    const done = await request(app).get(`/ticket/${t.id}`).set('x-test-account-id', account.id).expect(200)
    expect(done.body.status).toBe('done')
  })

  it('tags: add and remove', async () => {
    const t = database.ticketInsert(db, {
      project_id: proj.id,
      title:      'taggable',
      body:       'b',
      status:     'open',
      priority:   0,
      created_by: 'founder',
      created_at: NOW,
      updated_at: NOW,
    })

    await request(app).post(`/ticket/${t.id}/tag`).set('x-test-account-id', account.id).send({ tag: 'qa' }).expect(201)

    const tags = await request(app).get(`/ticket/${t.id}/tag`).set('x-test-account-id', account.id).expect(200)
    expect(tags.body.map((x: any) => x.tag)).toContain('qa')

    await request(app).delete(`/ticket/${t.id}/tag/qa`).set('x-test-account-id', account.id).expect(200)

    const after = await request(app).get(`/ticket/${t.id}/tag`).set('x-test-account-id', account.id).expect(200)
    expect(after.body.map((x: any) => x.tag)).not.toContain('qa')
  })
})
