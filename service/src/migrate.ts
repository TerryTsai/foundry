// One-shot migration: agent.project_id → agent.account_id,
// connection.project_id → connection.account_id.
//
// Run: npm run migrate

import Database from 'better-sqlite3'

const dbPath = process.env.DB_PATH ?? './foundry.db'
const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

console.log(`migrating ${dbPath}`)

// Check if migration already applied
const agentCols = sqlite.prepare(`PRAGMA table_info(agent)`).all() as { name: string }[]
if (agentCols.some(c => c.name === 'account_id')) {
  console.log('already migrated — account_id exists on agent')
  process.exit(0)
}
if (!agentCols.some(c => c.name === 'project_id')) {
  console.log('unexpected schema — agent has neither project_id nor account_id')
  process.exit(1)
}

sqlite.pragma('foreign_keys = OFF')
const tx = sqlite.transaction(() => {

  // ── 1. Add nullable account_id columns ──
  sqlite.exec(`ALTER TABLE agent ADD COLUMN account_id TEXT REFERENCES account(id)`)
  sqlite.exec(`ALTER TABLE connection ADD COLUMN account_id TEXT REFERENCES account(id)`)

  // ── 2. Backfill agent.account_id from project.owner_id ──
  const agentBackfill = sqlite.prepare(`
    UPDATE agent SET account_id = (
      SELECT owner_id FROM project WHERE project.id = agent.project_id
    )
  `).run()
  console.log(`backfilled ${agentBackfill.changes} agent rows`)

  // ── 3. Backfill connection.account_id ──
  const connBackfill = sqlite.prepare(`
    UPDATE connection SET account_id = (SELECT id FROM account LIMIT 1)
  `).run()
  console.log(`backfilled ${connBackfill.changes} connection rows`)

  // ── 4. Detect and rename agent name collisions within each account ──
  const dupes = sqlite.prepare(`
    SELECT account_id, name, COUNT(*) as cnt
    FROM agent
    WHERE account_id IS NOT NULL
    GROUP BY account_id, name
    HAVING cnt > 1
  `).all() as { account_id: string; name: string; cnt: number }[]

  for (const { account_id, name } of dupes) {
    const rows = sqlite.prepare(
      `SELECT id FROM agent WHERE account_id = ? AND name = ? ORDER BY created_at`
    ).all(account_id, name) as { id: string }[]
    // Keep the first, rename the rest
    for (let i = 1; i < rows.length; i++) {
      const newName = `${name}_${i + 1}`
      sqlite.prepare(`UPDATE agent SET name = ? WHERE id = ?`).run(newName, rows[i].id)
      console.log(`renamed duplicate agent: ${name} → ${newName} (id=${rows[i].id})`)
    }
  }

  // ── 5+6+7. Recreate tables with account_id NOT NULL, without project_id ──

  // -- Agent --
  sqlite.exec(`CREATE TABLE agent_new (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES account(id),
    connection_id    TEXT NOT NULL REFERENCES connection(id),
    name             TEXT NOT NULL,
    model            TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    max_tokens       INTEGER NOT NULL DEFAULT 8192,
    max_steps        INTEGER NOT NULL DEFAULT 20,
    temperature      REAL,
    reasoning_budget INTEGER,
    tools            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    UNIQUE(account_id, name)
  )`)

  sqlite.exec(`INSERT INTO agent_new
    SELECT id, account_id, connection_id, name, model, prompt,
           max_tokens, max_steps, temperature, reasoning_budget,
           tools, created_at, updated_at
    FROM agent`)

  sqlite.exec(`DROP TABLE agent`)
  sqlite.exec(`ALTER TABLE agent_new RENAME TO agent`)

  // -- Connection --
  sqlite.exec(`CREATE TABLE connection_new (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id),
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '{}',
    secrets    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  sqlite.exec(`INSERT INTO connection_new
    SELECT id, account_id, kind, name, config, secrets, created_at, updated_at
    FROM connection`)

  sqlite.exec(`DROP TABLE connection`)
  sqlite.exec(`ALTER TABLE connection_new RENAME TO connection`)
})

tx()

// Verify FK integrity after re-enabling
sqlite.pragma('foreign_keys = ON')
const fkErrors = sqlite.pragma('foreign_key_check') as unknown[]
if (fkErrors.length > 0) {
  console.error('foreign key check failed:', fkErrors)
  process.exit(1)
}

console.log('migration complete')
