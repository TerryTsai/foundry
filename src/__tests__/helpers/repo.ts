// Creates a fully-wired FoundryRepository backed by an in-memory SQLite DB.
// Each call returns a completely isolated database.

import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FoundryRepository } from "../../repository/impl/index.js";

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  brief TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  timestamp TEXT NOT NULL,
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  alternatives TEXT,
  made_by TEXT NOT NULL,
  impact TEXT NOT NULL,
  reversibility TEXT NOT NULL,
  supersedes TEXT REFERENCES decisions(id),
  tags TEXT
);

CREATE TABLE escalations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  draft_decision TEXT NOT NULL,
  draft_rationale TEXT NOT NULL,
  draft_alternatives TEXT,
  impact TEXT NOT NULL,
  created_at TEXT NOT NULL,
  timeout_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE TABLE loop_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  tasks_dispatched INTEGER DEFAULT 0,
  summary TEXT,
  error TEXT
);

CREATE TABLE capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  setup_guide TEXT NOT NULL,
  config_schema TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE capability_actions (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  action_type TEXT NOT NULL,
  script TEXT NOT NULL,
  param_schema TEXT,
  is_destructive INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 0,
  UNIQUE(capability_id, name)
);

CREATE TABLE project_capabilities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  credentials_enc TEXT,
  credentials_iv TEXT,
  credentials_tag TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_tested_at TEXT,
  last_test_status TEXT,
  last_test_output TEXT,
  configured_at TEXT,
  notes TEXT,
  UNIQUE(project_id, capability_id)
);

CREATE TABLE capability_executions (
  id TEXT PRIMARY KEY,
  project_capability_id TEXT NOT NULL REFERENCES project_capabilities(id),
  action_id TEXT NOT NULL REFERENCES capability_actions(id),
  params TEXT,
  triggered_by TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  duration_ms INTEGER
);

CREATE TABLE account_snapshots (
  id TEXT PRIMARY KEY,
  project_capability_id TEXT NOT NULL REFERENCES project_capabilities(id),
  captured_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  state TEXT NOT NULL,
  raw_response TEXT,
  triggered_by_execution TEXT REFERENCES capability_executions(id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  claimed_at TEXT,
  inputs TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_tasks_project ON tasks(project_id, created_at DESC);
CREATE INDEX idx_tasks_agent ON tasks(project_id, agent);
CREATE INDEX idx_tasks_claimed ON tasks(claimed_at);

CREATE TABLE project_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT,
  content_encoding TEXT,
  blob_hash TEXT,
  content_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  metadata TEXT,
  snapshot_of TEXT,
  supersedes TEXT REFERENCES artifacts(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id),
  output_name TEXT,
  CONSTRAINT content_xor_blob CHECK(("content" IS NOT NULL) != ("blob_hash" IS NOT NULL))
);

CREATE INDEX idx_artifacts_project ON artifacts(project_id, type, created_at);
CREATE INDEX idx_artifacts_hash ON artifacts(content_hash);
CREATE INDEX idx_artifacts_task ON artifacts(task_id, output_name);
CREATE UNIQUE INDEX uq_artifacts_task_output ON artifacts(task_id, output_name)
  WHERE task_id IS NOT NULL AND output_name IS NOT NULL;

CREATE TABLE onboarding_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  project_id TEXT REFERENCES projects(id)
);

CREATE TABLE onboarding_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES onboarding_sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
`;

export function makeTestRepo(): FoundryRepository {
  const blobDir = mkdtempSync(join(tmpdir(), "foundry-test-blobs-"));
  const raw = new Database(":memory:");
  raw.exec(SCHEMA_SQL);

  return new FoundryRepository(
    {
      dbPath: ":memory:", // unused since we pass raw
      blobDir,
      encryptionKey: "a".repeat(64), // 64 hex chars = 32 bytes
    },
    raw
  );
}

export function makeTestProject(repo: FoundryRepository) {
  return repo.projects.create({
    name: "Test Project",
    slug: "test-project",
    tagline: "A test project",
    problem: "Testing",
    user: "Developers",
    mvp: "Tests pass",
    constraints: "None",
    existing: "None",
    assumptions: [],
  });
}
