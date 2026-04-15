#!/usr/bin/env node
// Align session/execution status vocabulary with the ticket algebra:
//   running | finished | failed | cancelled
//
// Changes:
//   'done' → 'finished' (both tables)
//   'failed' stays (genuine failure)
//   NEW 'cancelled' is written by sessionKill/executionKill going forward
//
// Stop the foundry service before running. Backup taken automatically.
//
//   node scripts/migrate-session-execution-status.js

const Database = require('better-sqlite3')
const { copyFileSync, existsSync } = require('fs')

const DB_PATH = '/home/terry/foundry/service/foundry.db'
const BACKUP  = `${DB_PATH}.bak-pre-status-align`

if (!existsSync(BACKUP)) {
  copyFileSync(DB_PATH, BACKUP)
  console.log(`backed up → ${BACKUP}`)
}

const db = new Database(DB_PATH)
db.pragma('foreign_keys = OFF')
db.pragma('journal_mode = WAL')

db.exec('BEGIN')
try {
  const s = db.prepare(`UPDATE session   SET status = 'finished' WHERE status = 'done'`).run()
  const e = db.prepare(`UPDATE execution SET status = 'finished' WHERE status = 'done'`).run()
  console.log(`session:   done → finished = ${s.changes}`)
  console.log(`execution: done → finished = ${e.changes}`)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('rollback:', err)
  process.exit(1)
}

console.log('\nverification:')
console.log('  session statuses:',   db.prepare('SELECT status, count(*) c FROM session   GROUP BY status').all())
console.log('  execution statuses:', db.prepare('SELECT status, count(*) c FROM execution GROUP BY status').all())
