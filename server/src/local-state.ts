import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { chmodSync } from 'node:fs'

import type { WorkspaceSettings } from './schema.js'

export type AccountContext = { login: string; token: string }

export type LocalState = ReturnType<typeof createLocalState>

export function createLocalState(path: string) {
  const db = new Database(path)
  if (path !== ':memory:') chmodSync(path, 0o600)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      login TEXT PRIMARY KEY,
      github_token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker_failure (
      task_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      message TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return {
    close() { db.close() },
    saveAccount(login: string, token: string) {
      db.prepare('INSERT INTO account VALUES (?, ?, ?) ON CONFLICT(login) DO UPDATE SET github_token=excluded.github_token, updated_at=excluded.updated_at')
        .run(login, token, new Date().toISOString())
    },
    createSession(login: string) {
      const id = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      db.prepare('INSERT INTO session VALUES (?, ?, ?)').run(id, login, expiresAt)
      return { id, expiresAt }
    },
    accountForSession(id: string): AccountContext | null {
      const row = db.prepare(`SELECT account.login, account.github_token AS token, session.expires_at
        FROM session JOIN account ON account.login = session.login WHERE session.id = ?`).get(id) as { login: string; token: string; expires_at: string } | undefined
      if (!row || row.expires_at <= new Date().toISOString()) return null
      return { login: row.login, token: row.token }
    },
    firstAccount(): AccountContext | null {
      const row = db.prepare('SELECT login, github_token AS token FROM account ORDER BY updated_at DESC LIMIT 1').get() as AccountContext | undefined
      return row || null
    },
    removeSession(id: string) { db.prepare('DELETE FROM session WHERE id = ?').run(id) },
    settings(): WorkspaceSettings {
      const frequency = getSetting(db, 'frequency')
      const paused = getSetting(db, 'paused')
      return {
        frequency: frequency === '15m' || frequency === '30m' || frequency === '1h' || frequency === '4h' ? frequency : 'manual',
        paused: paused === 'true',
      }
    },
    saveSettings(settings: WorkspaceSettings) {
      setSetting(db, 'frequency', settings.frequency)
      setSetting(db, 'paused', String(settings.paused))
    },
    failure(taskKey: string): number {
      return (db.prepare('SELECT count FROM worker_failure WHERE task_key = ?').get(taskKey) as { count: number } | undefined)?.count || 0
    },
    recordFailure(taskKey: string, message: string): number {
      db.prepare(`INSERT INTO worker_failure VALUES (?, 1, ?, ?)
        ON CONFLICT(task_key) DO UPDATE SET count=count+1, message=excluded.message, updated_at=excluded.updated_at`)
        .run(taskKey, message.slice(0, 1000), new Date().toISOString())
      return this.failure(taskKey)
    },
    clearFailure(taskKey: string) { db.prepare('DELETE FROM worker_failure WHERE task_key = ?').run(taskKey) },
  }
}

function getSetting(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO setting VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}
