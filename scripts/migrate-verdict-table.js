#!/usr/bin/env node
// Promote verdict from an activity kind to a first-class table.
//
//   - Creates the `verdict` table and indexes.
//   - Back-fills rows from existing activity rows where kind='verdict'.
//     Each activity row is keyed to a verifier session; we look up
//     ticket_id / agent_id from the session row and parse pass/reason
//     from the JSON payload.
//   - Leaves the legacy activity rows in place (historical timeline
//     still renders them). Going forward, verdictReport writes only
//     to the verdict table.
//
// Stop the foundry service before running. Backup taken automatically.
//
//   node scripts/migrate-verdict-table.js

const Database = require('better-sqlite3')
const { copyFileSync, existsSync } = require('fs')
const { ulid } = require('ulid')

const DB_PATH = '/home/terry/foundry/service/foundry.db'
const BACKUP  = `${DB_PATH}.bak-pre-verdict-table`

if (!existsSync(BACKUP)) {
  copyFileSync(DB_PATH, BACKUP)
  console.log(`backed up → ${BACKUP}`)
}

const db = new Database(DB_PATH)
db.pragma('foreign_keys = OFF')
db.pragma('journal_mode = WAL')

db.exec('BEGIN')
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verdict (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT NOT NULL REFERENCES ticket(id),
      session_id TEXT NOT NULL REFERENCES session(id),
      agent_id   TEXT NOT NULL REFERENCES agent(id),
      pass       INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_verdict_ticket_id  ON verdict(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_verdict_session_id ON verdict(session_id);
  `)

  const legacyRows = db.prepare(`
    SELECT a.id, a.session_id, a.payload, a.created_at,
           s.ticket_id, s.agent_id
      FROM activity a
      JOIN session s ON s.id = a.session_id
     WHERE a.kind = 'verdict'
  `).all()

  const existing = new Set(
    db.prepare(`SELECT session_id FROM verdict`).all().map(r => r.session_id),
  )

  const insert = db.prepare(`
    INSERT INTO verdict (id, ticket_id, session_id, agent_id, pass, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let inserted = 0, skipped = 0, malformed = 0
  for (const r of legacyRows) {
    if (existing.has(r.session_id)) { skipped++; continue }
    try {
      const p = JSON.parse(r.payload)
      insert.run(
        ulid(), r.ticket_id, r.session_id, r.agent_id,
        p.pass ? 1 : 0, typeof p.reason === 'string' ? p.reason : '',
        r.created_at,
      )
      inserted++
    } catch { malformed++ }
  }

  console.log(`verdicts: inserted=${inserted}, skipped=${skipped}, malformed=${malformed}`)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('rollback:', err)
  process.exit(1)
}

console.log('\nverification:')
console.log('  verdict rows:', db.prepare('SELECT COUNT(*) c FROM verdict').get())
console.log('  pass/fail split:', db.prepare('SELECT pass, COUNT(*) c FROM verdict GROUP BY pass').all())
