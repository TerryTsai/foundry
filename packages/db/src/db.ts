import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Db = ReturnType<typeof drizzle<typeof schema>>

// eslint-disable-next-line max-lines-per-function -- migrations + pragmas are linear; splitting hurts readability
export function createDatabase(path: string): Db {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')   // safe with WAL, ~2x faster writes
  sqlite.pragma('cache_size = -64000')    // 64 MB page cache
  sqlite.pragma('temp_store = MEMORY')    // temp tables in RAM
  sqlite.pragma('mmap_size = 268435456')  // 256 MB mmap for faster reads
  sqlite.pragma('busy_timeout = 5000')    // wait 5s on lock instead of failing

  // Indexes — idempotent, safe on every startup. Big one-shot migrations
  // live outside this file (see scripts/migrate-activity.js).
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_session_id    ON activity(session_id);
    CREATE INDEX IF NOT EXISTS idx_activity_turn_id       ON activity(turn_id);
    CREATE INDEX IF NOT EXISTS idx_activity_execution_id  ON activity(execution_id);
    CREATE INDEX IF NOT EXISTS idx_activity_tool_use_id   ON activity(tool_use_id);
    CREATE INDEX IF NOT EXISTS idx_activity_kind          ON activity(kind);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_turn_order
      ON activity(session_id, turn_id, order_index) WHERE turn_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_execution_session_id   ON execution(session_id);

    CREATE INDEX IF NOT EXISTS idx_comment_ticket_id      ON comment(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_ticket_id      ON session(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_agent_id       ON session(agent_id);
    CREATE INDEX IF NOT EXISTS idx_session_started_at     ON session(started_at);

    CREATE INDEX IF NOT EXISTS idx_ticket_project_id      ON ticket(project_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_status          ON ticket(status);
    CREATE INDEX IF NOT EXISTS idx_ticket_project_status  ON ticket(project_id, status);

    CREATE INDEX IF NOT EXISTS idx_agent_account_id       ON agent(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_current_name
      ON agent(account_id, name) WHERE superseded_at IS NULL;

    CREATE TABLE IF NOT EXISTS event (
      id           TEXT PRIMARY KEY,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      kind         TEXT NOT NULL,
      data         TEXT NOT NULL DEFAULT '{}',
      caused_by    TEXT NOT NULL,
      caused_by_id TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_entity    ON event(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_event_entity_id ON event(entity_id);

    -- sandbox_token table dropped — per-session auth is now a stateless
    -- HMAC JWT (see auth/session-jwt.ts).
    DROP TABLE IF EXISTS sandbox_token;
  `)

  // ── one-shot schema simplifications (idempotent) ───────────────────
  // Each block guards on whether the migration has already happened
  // (column / table presence), so re-running is a no-op.

  // 1) Add ticket.tags JSON column, backfill from the legacy tag table,
  //    drop the table.
  if (!hasColumn(sqlite, 'ticket', 'tags')) {
    sqlite.exec(`ALTER TABLE ticket ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`)
  }
  if (hasTable(sqlite, 'tag')) {
    sqlite.exec(`
      UPDATE ticket SET tags = COALESCE(
        (SELECT json_group_array(tag) FROM tag WHERE tag.ticket_id = ticket.id),
        '[]'
      );
      DROP TABLE tag;
    `)
  }

  // 2) Migrate verdict rows into activity (kind='verdict') and drop
  //    the table. Verdict.id is a ULID; reusing it as activity.id
  //    can't collide with any existing activity row.
  if (hasTable(sqlite, 'verdict')) {
    sqlite.exec(`
      INSERT INTO activity (id, session_id, turn_id, kind, order_index,
                            payload, tool_use_id, execution_id,
                            tokens_in, tokens, created_at)
      SELECT id, session_id, NULL, 'verdict', 0,
             json_object('pass', json(CASE WHEN pass = 1 THEN 'true' ELSE 'false' END),
                         'reason', reason),
             NULL, NULL, NULL, NULL, created_at
      FROM verdict;
      DROP TABLE verdict;
    `)
  }

  // 3) Drop session.system_prompt — was duplicated by the prompt
  //    activity row, never read after write.
  if (hasColumn(sqlite, 'session', 'system_prompt')) {
    sqlite.exec(`ALTER TABLE session DROP COLUMN system_prompt`)
  }

  // 4) [REVERTED] Previously dropped execution.tool_use_id as
  //    "redundant". It wasn't — it's the natural join key between
  //    activity and execution, and removing it forced a backfill
  //    UPDATE that lost races. Restored below in block 6. Kept as a
  //    numbered tombstone so the blocks read as a chronological log.

  // 5) Verdicts move from kind='verdict' activity rows onto the session
  //    itself — one verdict per verifier session, so columns fit 1:1.
  //    Adds columns, backfills from activity, deletes the activity rows.
  if (!hasColumn(sqlite, 'session', 'verdict_pass')) {
    sqlite.exec(`
      ALTER TABLE session ADD COLUMN verdict_pass INTEGER;
      ALTER TABLE session ADD COLUMN verdict_reason TEXT;
      UPDATE session SET
        verdict_pass = (
          SELECT json_extract(a.payload, '$.pass')
          FROM activity a
          WHERE a.session_id = session.id AND a.kind = 'verdict'
          ORDER BY a.created_at LIMIT 1
        ),
        verdict_reason = (
          SELECT json_extract(a.payload, '$.reason')
          FROM activity a
          WHERE a.session_id = session.id AND a.kind = 'verdict'
          ORDER BY a.created_at LIMIT 1
        );
      DELETE FROM activity WHERE kind = 'verdict';
    `)
  }

  // 6) Restore execution.tool_use_id. Both activity and execution rows
  //    need to carry it so the two can be joined without an UPDATE on
  //    either side (see schema.ts for the full rationale). Backfill
  //    from the activity row that already points at each execution.
  if (!hasColumn(sqlite, 'execution', 'tool_use_id')) {
    sqlite.exec(`
      ALTER TABLE execution ADD COLUMN tool_use_id TEXT;
      UPDATE execution SET tool_use_id = (
        SELECT a.tool_use_id FROM activity a
        WHERE a.execution_id = execution.id
          AND a.tool_use_id IS NOT NULL
        LIMIT 1
      );
      CREATE INDEX IF NOT EXISTS idx_execution_tool_use_id ON execution(tool_use_id);
    `)
  }

  // 7) Drop ticket.priority — depends_on already sequences work; an
  //    integer field that's almost always 0 is just one more concept
  //    the founder has to think about.
  if (hasColumn(sqlite, 'ticket', 'priority')) {
    sqlite.exec(`ALTER TABLE ticket DROP COLUMN priority`)
  }

  // 8) Attachments — blob storage for ticket/comment images & PDFs.
  if (!hasTable(sqlite, 'attachment')) {
    sqlite.exec(`
      CREATE TABLE attachment (
        id         TEXT PRIMARY KEY,
        ticket_id  TEXT,
        comment_id TEXT,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        bytes      BLOB NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_attachment_ticket_id  ON attachment(ticket_id);
      CREATE INDEX idx_attachment_comment_id ON attachment(comment_id);
    `)
  }

  return drizzle(sqlite, { schema })
}

// ── helpers for the idempotent migrations ────────────────────────────

function hasTable(db: Database.Database, name: string): boolean {
  const r = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  return r != null
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}
