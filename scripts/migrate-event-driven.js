// Migration: flatten ticket status (drop outcome/claimed_at), drop
// session finish_reason, create event table. Run with:
//   node scripts/migrate-event-driven.js
//
// Safe to run multiple times — all operations are idempotent.

import Database from 'better-sqlite3'

const db = new Database('./service/foundry.db')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')

// ── 1. Create event table ──

db.exec(`
  CREATE TABLE IF NOT EXISTS event (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL DEFAULT '{}',
    caused_by   TEXT NOT NULL,
    caused_by_id TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_entity ON event(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_event_entity_id ON event(entity_id);
`)
console.log('event table: ok')

// ── 2. Flatten ticket status ──

// Check if outcome column still exists
const ticketCols = db.prepare("PRAGMA table_info(ticket)").all().map(c => c.name)

if (ticketCols.includes('outcome')) {
  // Migrate status values
  db.exec(`
    UPDATE ticket SET status = 'created'   WHERE status = 'opened' AND NOT EXISTS (SELECT 1 FROM session WHERE session.ticket_id = ticket.id);
    UPDATE ticket SET status = 'waiting'   WHERE status = 'opened' AND EXISTS (SELECT 1 FROM session WHERE session.ticket_id = ticket.id);
    UPDATE ticket SET status = 'running'   WHERE status = 'claimed';
    UPDATE ticket SET status = 'finished'  WHERE status = 'resolved' AND outcome = 'finished';
    UPDATE ticket SET status = 'failed'    WHERE status = 'resolved' AND outcome = 'failed';
    UPDATE ticket SET status = 'cancelled' WHERE status = 'resolved' AND outcome = 'cancelled';
    UPDATE ticket SET status = 'cancelled' WHERE status = 'resolved' AND outcome IS NULL;
  `)
  console.log('ticket status flattened')

  // SQLite >= 3.35.0 supports ALTER TABLE DROP COLUMN
  const version = db.prepare("SELECT sqlite_version() as v").get()
  const [major, minor] = version.v.split('.').map(Number)
  if (major > 3 || (major === 3 && minor >= 35)) {
    try { db.exec('ALTER TABLE ticket DROP COLUMN outcome') } catch {}
    try { db.exec('ALTER TABLE ticket DROP COLUMN claimed_at') } catch {}
    console.log('dropped outcome + claimed_at columns')
  } else {
    console.log('SQLite ' + version.v + ' — cannot drop columns. outcome/claimed_at remain but are unused.')
  }
} else {
  console.log('ticket status: already migrated')
}

// ── 3. Drop session finish_reason ──

const sessionCols = db.prepare("PRAGMA table_info(session)").all().map(c => c.name)

if (sessionCols.includes('finish_reason')) {
  const version = db.prepare("SELECT sqlite_version() as v").get()
  const [major, minor] = version.v.split('.').map(Number)
  if (major > 3 || (major === 3 && minor >= 35)) {
    try { db.exec('ALTER TABLE session DROP COLUMN finish_reason') } catch {}
    console.log('dropped session finish_reason')
  } else {
    console.log('SQLite ' + version.v + ' — cannot drop finish_reason. Column remains but is unused.')
  }
} else {
  console.log('session finish_reason: already dropped')
}

// ── 4. Backfill events for existing tickets ──

const { ulid } = await import('ulid')
const now = new Date().toISOString()

const tickets = db.prepare("SELECT id, status, created_at FROM ticket").all()
const existingEvents = db.prepare("SELECT 1 FROM event WHERE entity_type = 'ticket' LIMIT 1").get()

if (!existingEvents && tickets.length > 0) {
  const insert = db.prepare(`
    INSERT INTO event (id, entity_type, entity_id, kind, data, caused_by, created_at)
    VALUES (?, 'ticket', ?, ?, '{}', 'migration', ?)
  `)
  for (const t of tickets) {
    insert.run(ulid(), t.id, 'migrated_as_' + t.status, t.created_at)
  }
  console.log('backfilled', tickets.length, 'ticket events')
} else {
  console.log('events: already backfilled or no tickets')
}

db.pragma('foreign_keys = ON')
console.log('migration complete')
