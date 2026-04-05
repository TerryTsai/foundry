import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sandboxRuns } from './schema.js'

export function createDb(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')

  const db = drizzle(sqlite, { schema: { sandboxRuns } })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      image TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      exit_code INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `)

  return { db, sqlite }
}

export type Db = ReturnType<typeof createDb>['db']
