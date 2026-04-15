#!/usr/bin/env node
// Migrate the ticket schema to the new lean algebra:
//   states  : opened | claimed | resolved
//   outcomes: finished | failed | cancelled
//   relation: depends_on (was: blocked_by)
//   removed : parent_id, status='blocked', status='reopened'
//   agent   : adds verifiers JSON array
//
// Stop the foundry service before running. Backup is taken automatically.
//
//   node scripts/migrate-ticket-algebra.js

const Database = require('better-sqlite3')
const { copyFileSync, existsSync } = require('fs')

const DB_PATH = '/home/terry/foundry/service/foundry.db'
const BACKUP  = `${DB_PATH}.bak-pre-algebra`

if (!existsSync(BACKUP)) {
  copyFileSync(DB_PATH, BACKUP)
  console.log(`backed up → ${BACKUP}`)
}

const db = new Database(DB_PATH)
db.pragma('foreign_keys = OFF')
db.pragma('journal_mode = WAL')

db.exec('BEGIN')
try {
  // ── ticket: outcome column ──────────────────────────────────────────
  // Add outcome (nullable; populated only when state=resolved).
  const cols = db.prepare("PRAGMA table_info(ticket)").all().map(c => c.name)
  if (!cols.includes('outcome')) {
    db.exec(`ALTER TABLE ticket ADD COLUMN outcome TEXT`)
    console.log('+ ticket.outcome')
  }

  // ── ticket: backfill outcome from old status ────────────────────────
  const a = db.prepare(`UPDATE ticket SET outcome = 'finished' WHERE status = 'done'    AND outcome IS NULL`).run()
  const b = db.prepare(`UPDATE ticket SET outcome = 'failed'   WHERE status = 'failed'  AND outcome IS NULL`).run()
  console.log(`backfilled outcome: finished=${a.changes}, failed=${b.changes}`)

  // ── ticket: rename status values ────────────────────────────────────
  // done/failed → resolved (outcome was just backfilled)
  // open/reopened/blocked → opened
  // claimed stays
  const r1 = db.prepare(`UPDATE ticket SET status = 'resolved' WHERE status IN ('done','failed')`).run()
  const r2 = db.prepare(`UPDATE ticket SET status = 'opened'   WHERE status IN ('open','reopened','blocked')`).run()
  console.log(`renamed status: → resolved=${r1.changes}, → opened=${r2.changes}`)

  // ── ticket: rename blocked_by → depends_on ──────────────────────────
  if (cols.includes('blocked_by') && !cols.includes('depends_on')) {
    db.exec(`ALTER TABLE ticket RENAME COLUMN blocked_by TO depends_on`)
    console.log('renamed ticket.blocked_by → ticket.depends_on')
  }

  // ── ticket: drop parent_id ──────────────────────────────────────────
  if (cols.includes('parent_id')) {
    db.exec(`ALTER TABLE ticket DROP COLUMN parent_id`)
    console.log('- ticket.parent_id')
  }

  // ── agent: verifiers column ─────────────────────────────────────────
  const acols = db.prepare("PRAGMA table_info(agent)").all().map(c => c.name)
  if (!acols.includes('verifiers')) {
    db.exec(`ALTER TABLE agent ADD COLUMN verifiers TEXT`)
    console.log('+ agent.verifiers')
  }

  db.exec('COMMIT')
  console.log('done')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('rollback:', err)
  process.exit(1)
}

// ── verify ──────────────────────────────────────────────────────────────
console.log('\nverification:')
console.log('  ticket statuses:', db.prepare('SELECT status, count(*) c FROM ticket GROUP BY status').all())
console.log('  ticket outcomes (resolved only):', db.prepare("SELECT outcome, count(*) c FROM ticket WHERE status='resolved' GROUP BY outcome").all())
console.log('  ticket cols:',  db.prepare('PRAGMA table_info(ticket)').all().map(c => c.name).join(', '))
console.log('  agent cols:',   db.prepare('PRAGMA table_info(agent)').all().map(c => c.name).join(', '))
