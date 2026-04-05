import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { tickets } from '../../db/schema.js'

export function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema: { tickets } })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      parent_id TEXT REFERENCES tickets(id),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      claimed_at TEXT
    )
  `)

  return { db, sqlite }
}
