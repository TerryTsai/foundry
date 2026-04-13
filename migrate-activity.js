// Foundry schema migration: messages → activity, descriptions standardized,
// tags renamed, agent immutability, session.model dropped.
//
// This runs as a ONE-SHOT script in a single transaction. No back-compat.
// Foundry service MUST be stopped before running. Backup already taken.

const Database = require('better-sqlite3')
const { ulid } = require('ulid')

const DB_PATH = process.argv[2] ?? '/home/terry/foundry/service/foundry.db'
const db = new Database(DB_PATH)
db.pragma('foreign_keys = OFF')
db.pragma('journal_mode = WAL')

console.log(`migrating ${DB_PATH}`)

db.exec('BEGIN')
try {

// ══════════════════════════════════════════════════════════════════════
// 1. account — add description
// ══════════════════════════════════════════════════════════════════════

const accountCols = db.pragma('table_info(account)').map(c => c.name)
if (!accountCols.includes('description')) {
  db.exec(`ALTER TABLE account ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  console.log(' ✓ account.description added')
}

// ══════════════════════════════════════════════════════════════════════
// 2. ticket_tag → tag (rename)
// ══════════════════════════════════════════════════════════════════════

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name)
if (tables.includes('ticket_tag') && !tables.includes('tag')) {
  db.exec(`ALTER TABLE ticket_tag RENAME TO tag`)
  // rebuild the unique index on the renamed table
  db.exec(`DROP INDEX IF EXISTS idx_ticket_tag_unique`)
  db.exec(`DROP INDEX IF EXISTS idx_ticket_tag_ticket_id`)
  db.exec(`DROP INDEX IF EXISTS idx_ticket_tag_tag`)
  db.exec(`CREATE UNIQUE INDEX idx_tag_unique ON tag(ticket_id, tag)`)
  db.exec(`CREATE INDEX idx_tag_ticket_id ON tag(ticket_id)`)
  db.exec(`CREATE INDEX idx_tag_name ON tag(tag)`)
  console.log(' ✓ ticket_tag → tag renamed + indexes rebuilt')
}

// ══════════════════════════════════════════════════════════════════════
// 3. agent — rename prompt → description, add superseded_at,
//             drop updated_at and unique constraint on (account_id,name)
//    (SQLite requires full table recreate to rename+drop columns)
// ══════════════════════════════════════════════════════════════════════

const agentCols = db.pragma('table_info(agent)').map(c => c.name)
if (agentCols.includes('prompt') && !agentCols.includes('description')) {
  db.exec(`CREATE TABLE agent_new (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL REFERENCES account(id),
    connection_id     TEXT NOT NULL REFERENCES connection(id),
    name              TEXT NOT NULL,
    description       TEXT NOT NULL,
    model             TEXT NOT NULL,
    max_tokens        INTEGER NOT NULL DEFAULT 8192,
    max_steps         INTEGER NOT NULL DEFAULT 20,
    temperature       REAL,
    reasoning_budget  INTEGER,
    tools             TEXT,
    superseded_at     TEXT,
    created_at        TEXT NOT NULL
  )`)
  db.exec(`INSERT INTO agent_new
    (id, account_id, connection_id, name, description, model,
     max_tokens, max_steps, temperature, reasoning_budget, tools,
     superseded_at, created_at)
    SELECT
      id, account_id, connection_id, name, prompt, model,
      max_tokens, max_steps, temperature, reasoning_budget, tools,
      NULL, created_at
    FROM agent`)
  db.exec(`DROP TABLE agent`)
  db.exec(`ALTER TABLE agent_new RENAME TO agent`)
  db.exec(`DROP INDEX IF EXISTS idx_agent_account_id`)
  db.exec(`CREATE INDEX idx_agent_account_id ON agent(account_id)`)
  db.exec(`CREATE UNIQUE INDEX idx_agent_current_name
    ON agent(account_id, name) WHERE superseded_at IS NULL`)
  console.log(' ✓ agent rebuilt: prompt→description, +superseded_at, -updated_at, partial-unique on current name')
}

// ══════════════════════════════════════════════════════════════════════
// 4. ticket — body → description (recreate)
// ══════════════════════════════════════════════════════════════════════

const ticketCols = db.pragma('table_info(ticket)').map(c => c.name)
if (ticketCols.includes('body') && !ticketCols.includes('description')) {
  db.exec(`CREATE TABLE ticket_new (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    agent_id    TEXT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    priority    INTEGER NOT NULL DEFAULT 0,
    parent_id   TEXT,
    blocked_by  TEXT,
    claimed_at  TEXT,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`)
  db.exec(`INSERT INTO ticket_new
    (id, project_id, agent_id, title, description, status, priority,
     parent_id, blocked_by, claimed_at, created_by, created_at, updated_at)
    SELECT
      id, project_id, agent_id, title, body, status, priority,
      parent_id, blocked_by, claimed_at, created_by, created_at, updated_at
    FROM ticket`)
  db.exec(`DROP TABLE ticket`)
  db.exec(`ALTER TABLE ticket_new RENAME TO ticket`)
  db.exec(`DROP INDEX IF EXISTS idx_ticket_project_id`)
  db.exec(`DROP INDEX IF EXISTS idx_ticket_status`)
  db.exec(`DROP INDEX IF EXISTS idx_ticket_project_status`)
  db.exec(`CREATE INDEX idx_ticket_project_id     ON ticket(project_id)`)
  db.exec(`CREATE INDEX idx_ticket_status         ON ticket(status)`)
  db.exec(`CREATE INDEX idx_ticket_project_status ON ticket(project_id, status)`)
  console.log(' ✓ ticket rebuilt: body → description')
}

// ══════════════════════════════════════════════════════════════════════
// 5. session — drop model column (recreate)
// ══════════════════════════════════════════════════════════════════════

const sessionCols = db.pragma('table_info(session)').map(c => c.name)
if (sessionCols.includes('model')) {
  db.exec(`CREATE TABLE session_new (
    id            TEXT PRIMARY KEY,
    ticket_id     TEXT NOT NULL,
    agent_id      TEXT NOT NULL REFERENCES agent(id),
    system_prompt TEXT,
    status        TEXT NOT NULL DEFAULT 'running',
    error         TEXT,
    cost_usd      REAL,
    duration_ms   INTEGER,
    finish_reason TEXT,
    started_at    TEXT NOT NULL,
    ended_at      TEXT
  )`)
  db.exec(`INSERT INTO session_new
    (id, ticket_id, agent_id, system_prompt, status, error,
     cost_usd, duration_ms, finish_reason, started_at, ended_at)
    SELECT
      id, ticket_id, agent_id, system_prompt, status, error,
      cost_usd, duration_ms, finish_reason, started_at, ended_at
    FROM session`)
  db.exec(`DROP TABLE session`)
  db.exec(`ALTER TABLE session_new RENAME TO session`)
  db.exec(`DROP INDEX IF EXISTS idx_session_ticket_id`)
  db.exec(`DROP INDEX IF EXISTS idx_session_agent_id`)
  db.exec(`DROP INDEX IF EXISTS idx_session_started_at`)
  db.exec(`CREATE INDEX idx_session_ticket_id  ON session(ticket_id)`)
  db.exec(`CREATE INDEX idx_session_agent_id   ON session(agent_id)`)
  db.exec(`CREATE INDEX idx_session_started_at ON session(started_at)`)
  console.log(' ✓ session rebuilt: -model column')
}

// ══════════════════════════════════════════════════════════════════════
// 6. activity — NEW table, backfilled from message
// ══════════════════════════════════════════════════════════════════════

if (!tables.includes('activity') && tables.includes('message')) {
  db.exec(`CREATE TABLE activity (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES session(id),
    turn_id      TEXT,
    kind         TEXT NOT NULL,
    order_index  INTEGER NOT NULL DEFAULT 0,
    payload      TEXT NOT NULL,
    tool_use_id  TEXT,
    execution_id TEXT REFERENCES execution(id),
    tokens_in    INTEGER,
    tokens       INTEGER,
    created_at   TEXT NOT NULL
  )`)
  db.exec(`CREATE INDEX idx_activity_session_id   ON activity(session_id)`)
  db.exec(`CREATE INDEX idx_activity_turn_id      ON activity(turn_id)`)
  db.exec(`CREATE INDEX idx_activity_execution_id ON activity(execution_id)`)
  db.exec(`CREATE INDEX idx_activity_tool_use_id  ON activity(tool_use_id)`)
  db.exec(`CREATE INDEX idx_activity_kind         ON activity(kind)`)
  db.exec(`CREATE UNIQUE INDEX idx_activity_turn_order
    ON activity(session_id, turn_id, order_index) WHERE turn_id IS NOT NULL`)

  // Backfill: walk every message row, emit N activities per message.
  const execByTuId = new Map()
  for (const e of db.prepare(`SELECT id, tool_use_id FROM execution WHERE tool_use_id IS NOT NULL`).all()) {
    execByTuId.set(e.tool_use_id, e.id)
  }

  const msgs = db.prepare(`SELECT id, session_id, role, content, tokens, tokens_in, tool_call_count, created_at FROM message ORDER BY session_id, created_at`).all()
  const ins = db.prepare(`INSERT INTO activity
    (id, session_id, turn_id, kind, order_index, payload, tool_use_id, execution_id, tokens_in, tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  let nActivities = 0
  for (const m of msgs) {
    // Default: one activity per message, carrying the token totals.
    //   prompt  - user role, plain text
    //   said    - assistant role, plain text OR text block(s)
    //   thought - assistant reasoning block
    //   tool_call - assistant tool_use block
    //   reconcile - system with reconcile JSON
    let parsed = null
    try { parsed = JSON.parse(m.content) } catch { /* fall through; treat as text */ }

    // System reconcile row.
    if (m.role === 'system' && parsed && typeof parsed === 'object' && 'reconcile' in parsed) {
      ins.run(
        ulid(), m.session_id, m.id, 'reconcile', 0,
        JSON.stringify(parsed),
        null, null, m.tokens_in ?? null, m.tokens ?? null, m.created_at,
      )
      nActivities++
      continue
    }

    // User prompt (plain text).
    if (m.role === 'user') {
      ins.run(
        ulid(), m.session_id, m.id, 'prompt', 0,
        JSON.stringify({ text: m.content }),
        null, null, m.tokens_in ?? null, m.tokens ?? null, m.created_at,
      )
      nActivities++
      continue
    }

    // Assistant with JSON content blocks.
    if (Array.isArray(parsed)) {
      let orderIndex = 0
      let firstRow = true
      for (const b of parsed) {
        const id = ulid()
        const type = b?.type
        if (type === 'text' && typeof b.text === 'string') {
          ins.run(
            id, m.session_id, m.id, 'said', orderIndex,
            JSON.stringify({ text: b.text }),
            null, null,
            firstRow ? m.tokens_in ?? null : null,
            firstRow ? m.tokens    ?? null : null,
            m.created_at,
          )
        } else if (type === 'thinking' && typeof b.thinking === 'string') {
          ins.run(
            id, m.session_id, m.id, 'thought', orderIndex,
            JSON.stringify({ text: b.thinking, char_count: b.thinking.length, signature: b.signature ?? null }),
            null, null,
            firstRow ? m.tokens_in ?? null : null,
            firstRow ? m.tokens    ?? null : null,
            m.created_at,
          )
        } else if (type === 'tool_use' && typeof b.id === 'string') {
          const execId = execByTuId.get(b.id) ?? null
          ins.run(
            id, m.session_id, m.id, 'tool_call', orderIndex,
            JSON.stringify({ name: b.name ?? null, input: b.input ?? {} }),
            b.id, execId,
            firstRow ? m.tokens_in ?? null : null,
            firstRow ? m.tokens    ?? null : null,
            m.created_at,
          )
        } else {
          // Unknown block type: preserve raw payload under kind='said' so
          // nothing is silently dropped; founder can inspect.
          ins.run(
            id, m.session_id, m.id, 'said', orderIndex,
            JSON.stringify({ unknown_block: b }),
            null, null,
            firstRow ? m.tokens_in ?? null : null,
            firstRow ? m.tokens    ?? null : null,
            m.created_at,
          )
        }
        orderIndex++
        firstRow = false
        nActivities++
      }
      continue
    }

    // Assistant with plain text (legacy ai-SDK path).
    if (m.role === 'assistant') {
      ins.run(
        ulid(), m.session_id, m.id, 'said', 0,
        JSON.stringify({ text: m.content }),
        null, null, m.tokens_in ?? null, m.tokens ?? null, m.created_at,
      )
      nActivities++
      continue
    }

    // Fallback: unknown role — preserve as a generic 'said' for audit.
    ins.run(
      ulid(), m.session_id, m.id, 'said', 0,
      JSON.stringify({ role: m.role, text: m.content }),
      null, null, m.tokens_in ?? null, m.tokens ?? null, m.created_at,
    )
    nActivities++
  }

  console.log(` ✓ activity created; backfilled ${nActivities} rows from ${msgs.length} messages`)

  db.exec(`DROP TABLE message`)
  console.log(' ✓ message table dropped')
}

db.exec('COMMIT')
console.log('\nmigration complete.')

// Post-migration sanity read
console.log('\n── verify ──')
console.log('activity rows:',   db.prepare(`SELECT COUNT(*) n FROM activity`).get().n)
console.log('activity kinds:',  db.prepare(`SELECT kind, COUNT(*) n FROM activity GROUP BY kind`).all().map(r => `${r.kind}=${r.n}`).join(', '))
console.log('tool_call activities with execution:',
  db.prepare(`SELECT COUNT(*) n FROM activity WHERE kind='tool_call' AND execution_id IS NOT NULL`).get().n)
console.log('tool_call activities without execution (historical):',
  db.prepare(`SELECT COUNT(*) n FROM activity WHERE kind='tool_call' AND execution_id IS NULL`).get().n)
console.log('agent rows:', db.prepare(`SELECT COUNT(*) n FROM agent`).get().n,
  'with description column:', db.pragma('table_info(agent)').some(c => c.name === 'description'))
console.log('ticket.description column:', db.pragma('table_info(ticket)').some(c => c.name === 'description'))
console.log('session.model dropped:', !db.pragma('table_info(session)').some(c => c.name === 'model'))
console.log('tag table exists:', db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name='tag'`).get().n > 0)
console.log('account.description column:', db.pragma('table_info(account)').some(c => c.name === 'description'))

} catch (err) {
  db.exec('ROLLBACK')
  console.error('ROLLED BACK:', err)
  process.exit(1)
}
