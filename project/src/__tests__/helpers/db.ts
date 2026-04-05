import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { projects } from '../../db/schema.js'

export function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')

  const db = drizzle(sqlite, { schema: { projects } })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      workspace TEXT NOT NULL,
      schedule_interval INTEGER NOT NULL DEFAULT 600,
      concurrency_limit INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL
    )
  `)

  return { db, sqlite }
}
