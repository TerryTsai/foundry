#!/usr/bin/env node
// Create or clean dummy connections + agent for testing the ToolPicker UI.
//
//   node scripts/dummy.js create   # insert 12 dummy-* connections + 1 dummy agent
//   node scripts/dummy.js clean    # delete everything with a 'dummy-' name prefix
//
// Safe to run while the service is up — writes go through the same DB.

const Database = require('better-sqlite3')
const { ulid } = require('ulid')

const DB_PATH = '/home/terry/foundry/server/foundry.db'
const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

const action = process.argv[2]
if (action !== 'create' && action !== 'clean') {
  console.error('usage: node scripts/dummy.js <create|clean>')
  process.exit(1)
}

function getAccountId() {
  const row = db.prepare('SELECT id FROM account ORDER BY created_at LIMIT 1').get()
  if (!row) throw new Error('no account rows — log in once before seeding')
  return row.id
}

function clean() {
  const a = db.prepare(`DELETE FROM agent      WHERE name LIKE 'dummy-%'`).run()
  const c = db.prepare(`DELETE FROM connection WHERE name LIKE 'dummy-%'`).run()
  console.log(`removed ${a.changes} agent(s), ${c.changes} connection(s)`)
}

// Dummy credentials shaped to pass the provider's required-field check.
// Every integration's provider validates presence of required credential
// keys at create-time, so we stub them with placeholder strings. They
// don't have to authenticate anywhere — we're only exercising the UI.
const DUMMY_CREDS = {
  anthropic:   { api_key: 'sk-ant-dummy' },
  aws:         { access_key_id: 'AKIADUMMY', secret_access_key: 'dummy' },
  cloudflare:  { api_token: 'dummy' },
  resend:      { api_key: 're_dummy' },
  posthog:     { api_key: 'phx_dummy', project_id: '0' },
  sentry:      { auth_token: 'sntrys_dummy', organization: 'dummy-org' },
  supabase:    { project_url: 'https://dummy.supabase.co', service_role_key: 'dummy' },
  clerk:       { secret_key: 'sk_test_dummy' },
  stripe:      { secret_key: 'sk_test_dummy' },
  linear:      { api_key: 'lin_api_dummy' },
  uptimerobot: { api_key: 'u0-dummy' },
  calcom:      { api_key: 'cal_live_dummy' },
  crisp:       { identifier: 'dummy', key: 'dummy', website_id: 'dummy' },
}

function create() {
  const accountId = getAccountId()
  const existing = db.prepare(`SELECT kind FROM connection WHERE name LIKE 'dummy-%'`).all().map(r => r.kind)
  if (existing.length) {
    console.log(`${existing.length} dummy connection(s) already exist; run 'clean' first to reseed`)
    return
  }

  const now = new Date().toISOString()
  const insertConn = db.prepare(`
    INSERT INTO connection (id, account_id, kind, name, config, secrets, created_at, updated_at)
    VALUES (@id, @account_id, @kind, @name, @config, @secrets, @created_at, @updated_at)
  `)
  const byKind = {}
  for (const [kind, secrets] of Object.entries(DUMMY_CREDS)) {
    const row = {
      id:         ulid(),
      account_id: accountId,
      kind,
      name:       `dummy-${kind}`,
      config:     '{}',
      secrets:    JSON.stringify(secrets),
      created_at: now,
      updated_at: now,
    }
    insertConn.run(row)
    byKind[kind] = row.id
  }
  console.log(`inserted ${Object.keys(DUMMY_CREDS).length} connections`)

  // Agent pointing at dummy-anthropic so the edit page has something to open.
  const agentId = ulid()
  db.prepare(`
    INSERT INTO agent (
      id, account_id, connection_id, name, description, model,
      max_tokens, max_steps, temperature, reasoning_budget, tools,
      superseded_at, created_at
    ) VALUES (
      @id, @account_id, @connection_id, @name, @description, @model,
      8192, 20, NULL, NULL, NULL, NULL, @created_at
    )
  `).run({
    id:            agentId,
    account_id:    accountId,
    connection_id: byKind.anthropic,
    name:          'dummy-agent',
    description:   'Dummy agent for ToolPicker UI testing. Safe to delete.',
    model:         'claude-sonnet-4-5-20251001',
    created_at:    now,
  })
  console.log(`inserted agent ${agentId} (dummy-agent)`)
  console.log('open /settings/agents → dummy-agent → edit to exercise the picker')
}

if (action === 'clean') clean()
else create()
