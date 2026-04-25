// Minimal in-memory db harness for adapter tests. Uses better-sqlite3
// directly to set up the bare schema crud + analytics + sandbox need.
// Avoids depending on drizzle-kit migrations — adapter tests only exercise
// a slice of the schema each.

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@foundry/db'
import type { Db } from '@foundry/db'

const SCHEMA_SQL = `
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    github_id INTEGER NOT NULL UNIQUE,
    login TEXT NOT NULL,
    name TEXT, email TEXT, avatar_url TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE auth_session (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL DEFAULT '' REFERENCES account(id),
    repo TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    max_agents INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE connection (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    secrets TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE ticket (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    agent_id TEXT,
    title TEXT NOT NULL, description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    depends_on TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE comment (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES ticket(id),
    session_id TEXT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE attachment (
    id TEXT PRIMARY KEY,
    ticket_id TEXT, comment_id TEXT,
    name TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL, bytes BLOB NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE agent (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    name TEXT NOT NULL, description TEXT NOT NULL,
    model TEXT NOT NULL,
    max_tokens INTEGER NOT NULL DEFAULT 8192,
    max_steps INTEGER NOT NULL DEFAULT 20,
    temperature REAL,
    reasoning_budget INTEGER,
    tools TEXT, verifiers TEXT,
    superseded_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES ticket(id),
    agent_id TEXT NOT NULL REFERENCES agent(id),
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    verdict_pass INTEGER,
    verdict_reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session(id),
    turn_id TEXT,
    kind TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    tool_use_id TEXT,
    execution_id TEXT,
    tokens_in INTEGER,
    tokens INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE execution (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    tool_use_id TEXT, tool_name TEXT, tool_input TEXT,
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    exit_code INTEGER,
    exit_signal TEXT,
    stdout TEXT, stderr TEXT,
    duration_ms INTEGER,
    timeout_ms INTEGER NOT NULL,
    memory_mb INTEGER,
    peak_memory_mb REAL,
    cpu_ms INTEGER,
    net_rx_bytes INTEGER,
    net_tx_bytes INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE event (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    caused_by TEXT NOT NULL,
    caused_by_id TEXT,
    created_at TEXT NOT NULL
  );
`

export function makeTestDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.exec(SCHEMA_SQL)
  return drizzle(sqlite, { schema })
}
