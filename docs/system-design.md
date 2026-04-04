# Foundry — System Design

*Internal codename. Version 1.1. Living document.*

-----

## Table of Contents

1. [Overview](#1-overview)
1. [Principles](#2-principles)
1. [Architecture](#3-architecture)
1. [Tech Stack](#4-tech-stack)
1. [Repository](#5-repository)
1. [Data Model](#6-data-model)
1. [Engine](#7-engine)
1. [Capability System](#8-capability-system)
1. [Artifact System](#9-artifact-system)
1. [UI](#10-ui)
1. [Onboarding](#11-onboarding)
1. [Admin API](#12-admin-api)
1. [Security](#13-security)
1. [Operational](#14-operational)
1. [Build Phases](#15-build-phases)
1. [Open Questions](#16-open-questions)

- [Appendix A: Document Maintenance](#appendix-a-document-maintenance)
- [Appendix B: Conventions and Preferences](#appendix-b-conventions-and-preferences)
- [Appendix C: Out of Scope for V1](#appendix-c-out-of-scope-for-v1)

-----

## 1. Overview

### 1.1 What It Is

Foundry is a locally-hosted autonomous project engine for solo founders. It moves a software project forward without requiring the founder's continuous attention. It makes decisions, takes actions, and surfaces only the things that genuinely require human judgment.

The founder's role is not to drive the project. It is to set direction, approve or override when the system escalates, and configure external integrations when needed. Everything else happens autonomously.

### 1.2 The Core Problem

Solo founders lose ideas to analysis paralysis and decision fatigue. Many decisions — what stack to use, how to structure a repo, what GTM channel to try first — don't require deep founder input. They require a decision to have been made. The founder gets stuck not because the decisions are hard, but because they're decisions at all.

Foundry removes the founder from the critical path for most decisions. It acts, logs everything, and escalates the rare decisions that genuinely need the founder's judgment — with a concrete recommendation already formed.

### 1.3 The First Project

Foundry's first project is **Snapquery**: a fast, user-friendly web app for data exploration. Users drag-and-drop files to view, filter, and sort data, or write SQL queries powered by DuckDB. This is a reimplementation. Foundry will manage all decisions about the rebuild.

Foundry also runs itself as a project — its own build decisions are logged in Foundry.

### 1.4 V1 Scope

- Single user, home server deployment
- One active project at a time (expandable via config)
- No external notifications — founder checks the UI
- No authentication (local network, trusted environment)
- Engine uses Claude Agent SDK with Claude Max subscription auth
- Full capability, artifact, and decision persistence in SQLite

-----

## 2. Principles

These are not preferences. They are the constraints that should govern every technical decision in this codebase. If a proposed change violates one, it needs explicit justification.

**The founder is never a bottleneck.** The engine runs on its own schedule. Escalations time out and auto-resolve. Nothing waits for human input.

**Storage details do not leak.** Nothing outside `src/repository/` knows that SQLite exists, how credentials are encrypted, what a git bundle is, or where the blob store lives. The repository boundary is enforced structurally, not by convention.

**Every layer must earn its place.** Abstraction is not free. A layer exists only if it has a clear, singular responsibility that cannot be handled by its neighbors without coupling. Default to flat; add layers only when the problem demands it.

**Capabilities and scripts are data.** No code changes are required to add an integration. Everything — capability definitions, action scripts, credential schemas — is stored in the database and managed from the UI.

**The system is self-contained.** Copying `foundry.db` + `foundry.blobs/` + the encryption key to a new server resumes the project. No external state is required that is not captured in persistence.

**Append-only for decisions and logs.** The decision log, activity log, and execution log are never updated or deleted. Corrections are new entries that supersede old ones. The history of what was decided and why is permanent.

**Simple over clever.** The first working solution is usually correct enough. Complexity is introduced only when the problem demonstrably demands it, not in anticipation of problems.

-----

## 3. Architecture

### 3.1 Layers

```
┌──────────────────────────────────────────────────┐
│  UI (React, static build)                        │
│  Observation + override only. No business logic. │
└───────────────────��┬─────────────────────────────┘
                     │ HTTP / REST
┌────────────────────▼─────────────────────────────┐
│  API (Express routes)                            │
│  Thin. Validates input, calls repository,        │
│  returns data. No domain logic.                  │
├──────────────────────────────────────────────────┤
│  Engine (Claude Agent SDK, background loop)      │
│  Dynamic planning. Makes decisions. Creates      │
│  escalations. Executes capabilities. Snapshots   │
│  artifacts. Calls only the repository.           │
├──────────────────────────────────────────────────┤
│  Repository (IFoundryRepository)                 │
│  Single interface to all persistence.            │
│  Owns: SQLite, blob store, encryption, git.      │
└──────────────────────────────────────────────────┘
```

### 3.2 Process Model

A single Node.js process:

```
src/index.ts
├── openRepository(config)           ← opens DB, blob store, validates key
├── new Scheduler(config, repo)      ← setInterval: ticks the engine loop
│     scheduler.start()
└── startServer(repo, scheduler, config) ← Express: API + static UI
```

No separate daemon. No separate web server. Express serves both `/api/*` and the static React build from `ui/dist`. Nginx sits in front and handles SSL termination and static file caching.

The scheduler is passed to the server so the admin API (`/api/admin/*`) can trigger runs and query run status without the server needing direct engine imports.

### 3.3 Data Flow

```
Engine tick
  └── repo.engineRuns.start(projectId)
  └── query() session opens (Agent SDK)
        agent calls: get_project_context
        agent reasons about gaps
        agent calls: log_decision / create_escalation / execute_capability_action
        session ends
  └── repo.engineRuns.complete(runId, summary)

UI polls /api/decisions, /api/escalations, /api/activity
  └── founder reviews escalation
  └── POST /api/escalations/:id/resolve
  └── engine picks up on next tick

POST /api/admin/run/:projectId
  └── scheduler.runNow(projectId)     ← immediate manual trigger
```

The engine is the only writer to decisions, activity_log, and capability_executions. The API writes only to escalations (resolutions) and projects (new projects from onboarding). Both go through the repository.

-----

## 4. Tech Stack

|Layer          |Choice                          |Reason                                                                |
|---------------|--------------------------------|----------------------------------------------------------------------|
|Runtime        |Node.js 18+ (TypeScript)        |Long-running process, async-native, Agent SDK is TypeScript-first     |
|Agent          |`@anthropic-ai/claude-agent-sdk`|Powers the engine loop; authenticates via Claude Max subscription     |
|Web server     |Express                         |Thin, well-understood, no magic; serves API + static files            |
|Database       |SQLite via Drizzle ORM          |Single file, zero-ops, full SQL, type-safe schema, easy migrations    |
|Blob store     |Content-addressed filesystem    |Large artifacts stored by SHA-256 hash; simple to rsync               |
|Encryption     |Node.js `crypto` (AES-256-GCM)  |Built-in, auditable, no third-party credential handling               |
|UI             |React + Vite 5                  |Static build served by Express; Vite proxies to API in dev            |
|Styling        |Tailwind CSS v3                 |Matches approved mockups; no runtime overhead                         |
|Process manager|PM2                             |Restart on crash, startup on boot, simple log management              |
|Reverse proxy  |Nginx                           |SSL termination, static file caching; Express handles only API in prod|

### 4.1 Tradeoffs

**SQLite over Postgres.** Postgres adds an ops burden (separate process, connections, backups) that is not justified for a single-user local tool. SQLite's single-file model is what makes the portability guarantee possible. Drizzle ORM handles migrations cleanly. If this becomes multi-user or high-write, migrating to Postgres is a repository-internal change — nothing outside `src/repository/` changes.

**Single process over daemon + web server.** Separating the engine and web server adds deployment complexity and IPC overhead for no benefit at this scale. The engine loop runs as a `setInterval` background job in the same process. This is simpler to reason about, simpler to deploy, and simpler to debug.

**Dynamic planning over fixed pipeline.** A hardcoded stage pipeline is predictable but misses project-specific decisions and cannot adapt. A dynamic agent that reads the current state and determines what to do next is more powerful and requires less maintenance as projects evolve. The tradeoff is that behavior is less predictable — mitigated by the decision log which makes all agent reasoning visible and auditable.

**Claude Agent SDK `query()` over raw Anthropic API.** The SDK provides the agent loop, tool use infrastructure, in-process MCP server support, and subscription-based auth. The raw API would require building all of this manually. `query()` is the SDK's single-turn async generator interface: stateless per call, no session files, suitable for both the engine (multi-turn) and onboarding (single-turn per HTTP request).

**Synchronous repository methods.** All store methods are synchronous (better-sqlite3 synchronous API), not async. This simplifies call sites throughout the engine and API. The only async operations are capability execution (subprocess/HTTP) and artifact snapshots (git bundle creation), which are correctly async.

**Append-only decisions.** Mutability would make the decision log easier to query (always current) but would destroy the audit trail. The "state of world" query — latest decision per topic — is a straightforward `GROUP BY` with an index. The audit trail is worth this cost.

-----

## 5. Repository

### 5.1 Purpose and Boundary

The repository is the single interface to all persistence in Foundry. Its job is to translate between the domain language (projects, decisions, artifacts, credentials) and the storage mechanisms (SQLite, filesystem, encryption).

**Nothing outside `src/repository/` may import:**

- `drizzle-orm` or `better-sqlite3`
- `node:crypto`
- Git operations (`child_process` for git bundle)
- Blob store path operations

This is enforced via ESLint `no-restricted-imports`. A violation is a build error.

### 5.2 Public Interface

```typescript
// src/repository/index.ts

export interface IFoundryRepository {
  readonly projects:     IProjectRepository;
  readonly decisions:    IDecisionRepository;
  readonly escalations:  IEscalationRepository;
  readonly capabilities: ICapabilityRepository;
  readonly artifacts:    IArtifactRepository;
  readonly activity:     IActivityRepository;
  readonly engineRuns:   IEngineRunRepository;
  readonly executions:   IExecutionRepository;
  readonly onboarding:   IOnboardingRepository;

  backup(options: BackupOptions): Promise<BackupResult>;
  healthCheck(): Promise<HealthStatus>;
  close(): Promise<void>;
}

// Entry point — called once from src/index.ts
export async function openRepository(config: RepositoryConfig): Promise<IFoundryRepository>;

// Used during server migration
export async function restoreRepository(
  backupPath: string,
  targetDir: string,
  encryptionKey: string,
): Promise<IFoundryRepository>;
```

### 5.3 Sub-Repository Interfaces

> ⚠️ Note: all store methods are **synchronous** (better-sqlite3 sync API). Only async operations that involve subprocesses or filesystem I/O (capability execution, artifact snapshots, backup) are async.

**Projects**

```typescript
interface IProjectRepository {
  create(brief: ProjectBrief & { name: string; slug: string }): Project;
  get(id: string): Project | null;
  list(status?: ProjectStatus): Project[];
  updateStatus(id: string, status: ProjectStatus): void;
  updateBrief(id: string, brief: ProjectBrief): void;
}
```

**Decisions (append-only)**

```typescript
interface IDecisionRepository {
  append(decision: NewDecision): Decision;
  // Enforces: no UPDATE ever. Validates supersedes chain.

  query(filter: DecisionFilter): Decision[];
  // filter: { projectId, domain?, impact?, madeBy?, since? }

  latestPerTopic(projectId: string, domain?: string): Decision[];
  // "State of World" — resolves supersedes chains internally.

  getHistory(projectId: string, topic: string): Decision[];
  // Full lineage for one topic, newest first.
}
```

**Escalations**

```typescript
interface IEscalationRepository {
  create(escalation: NewEscalation): Escalation;
  getOpen(projectId: string): Escalation[];
  get(id: string): Escalation | null;
  resolve(id: string, resolution: EscalationResolution): void;
  // Validates: not already resolved. Writes to activity log internally.
}
```

**Capabilities**

```typescript
interface ICapabilityRepository {
  listDefinitions(category?: string): CapabilityDefinition[];
  getDefinition(id: string): CapabilityDefinition | null;
  createDefinition(def: NewCapabilityDefinition): CapabilityDefinition;
  updateDefinition(id: string, updates: Partial<NewCapabilityDefinition>): void;

  listActions(capabilityId: string): CapabilityAction[];
  createAction(capabilityId: string, action: Omit<CapabilityAction, 'id' | 'capabilityId'>): CapabilityAction;

  addToProject(projectId: string, capabilityId: string): ProjectCapability;
  listForProject(projectId: string): ProjectCapability[];
  getProjectCapability(id: string): ProjectCapability | null;

  saveCredentials(projectCapabilityId: string, credentials: Record<string, string>): void;
  // Encryption is internal. Credentials are never readable after write.

  setStatus(id: string, status: CapabilityStatus, detail?: string): void;

  execute(
    projectCapabilityId: string,
    actionName: string,
    params: Record<string, string>,
    triggeredBy: 'agent' | 'founder-test',
  ): Promise<ExecutionResult>;
  // Decrypts credentials internally, injects into subprocess, wipes after.
  // Appends to execution log internally.

  getExecutionHistory(projectCapabilityId: string, limit?: number): CapabilityExecution[];
  captureAccountState(projectCapabilityId: string, trigger: AccountState['trigger']): Promise<void>;
  getLatestAccountState(projectCapabilityId: string): AccountState | null;
}
```

**Artifacts**

```typescript
interface IArtifactRepository {
  snapshotCode(projectId: string, repoPath: string, trigger?: string): Promise<Artifact>;
  // Creates git bundle, compresses, routes to inline or blob store by size.

  restoreCode(artifactId: string, targetPath: string): Promise<void>;
  // Retrieves from wherever stored, decompresses, clones.

  store(item: NewArtifact): Artifact;
  // item: { projectId, type, name, content: string | Buffer, metadata? }

  get(artifactId: string): ArtifactWithContent;
  list(projectId: string, type?: ArtifactType): Artifact[];
  latestOfType(projectId: string, type: ArtifactType): Artifact | null;
}
```

**Engine Runs**

```typescript
interface IEngineRunRepository {
  start(projectId: string): EngineRun;
  complete(runId: string, summary: RunSummary): void;
  fail(runId: string, error: string): void;
  getCurrent(projectId: string): EngineRun | null;
  getLastCompleted(projectId: string): EngineRun | null;
  recoverStalledRuns(): number;
  // Called on startup. Marks in-flight runs as failed. Returns count.
}
```

**Onboarding**

```typescript
interface IOnboardingRepository {
  createSession(): OnboardingSession;
  getSession(id: string): OnboardingSession | null;
  completeSession(id: string, projectId: string): void;
  appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): OnboardingMessage;
  getMessages(sessionId: string): OnboardingMessage[];
  listActive(): OnboardingSession[];
}
```

### 5.4 Implementation Structure

```
src/repository/
  index.ts                ← public interface + factory functions
  types.ts                ← domain types only (no DB column names)
  config.ts               ← RepositoryConfig type
  impl/
    index.ts              ← FoundryRepository class
    backup.ts             ← backup/restore logic
    blob-store.ts         ← content-addressed filesystem
    crypto.ts             ← AES-256-GCM (used only in impl/)
    git.ts                ← git bundle operations (used only in impl/)
    executor.ts           ← capability action execution
    stores/
      projects.ts
      decisions.ts        ← append-only invariant enforced here
      escalations.ts
      capabilities.ts
      artifacts.ts        ← inline vs blob routing
      activity.ts
      engine-runs.ts
      executions.ts
      onboarding.ts       ← chat session + message persistence
    schema/
      index.ts            ← Drizzle table definitions
      migrations/         ← generated by drizzle-kit
```

### 5.5 Backup and Restore

```typescript
interface BackupOptions {
  path: string;
  compress?: boolean;       // default: true
  includeBlobs?: boolean;   // default: true
  verify?: boolean;         // default: true — checksums the output
}

interface BackupResult {
  path: string;
  sizeBytes: number;
  durationMs: number;
  checksum: string;         // SHA-256 of the archive
  includes: { database: true; blobs: boolean; blobCount: number };
}
```

`backup()` internally:

1. Uses SQLite's **online backup API** (`sqlite3_backup_init`) — safe while the DB is open and being written. Not a file copy.
1. Copies the blob store directory.
1. Packs into a `.tar.gz` archive.
1. Optionally verifies integrity by unpacking and running SQLite `PRAGMA integrity_check`.

`restoreRepository()` is a static function (no instance needed):

1. Unpacks archive to target directory.
1. Validates SQLite integrity.
1. Opens and returns a repository instance.

**The encryption key is not included in the backup.** It must be provided at restore time. This is intentional — the backup is safe to store on untrusted media.

-----

## 6. Data Model

All tables are defined in `src/repository/impl/schema/index.ts` using Drizzle ORM. The schema is the source of truth. Raw SQL should never be written outside the repository.

### 6.1 Overview

```
projects                    ← project briefs and status
decisions                   ← append-only decision log
escalations                 ← pending founder decisions
activity_log                ← append-only event stream
engine_runs                 ← engine session tracking

capabilities                ← reusable integration templates
capability_actions          ← scripts/configs per capability
project_capabilities        ← per-project configured instances
capability_executions       ← append-only action execution log
account_snapshots           ← point-in-time external service state

artifacts                   ← code snapshots, content, configs
onboarding_sessions         ← chat session persistence
onboarding_messages         ← individual chat messages
```

### 6.2 Schema

```sql
-- ── Core ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active',
  -- active | paused | complete | archived
  brief         TEXT NOT NULL,
  -- JSON: { tagline, problem, user, mvp, constraints, existing, assumptions[] }
  created_at    TEXT NOT NULL
);

-- APPEND ONLY. No UPDATE. No DELETE.
CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  timestamp       TEXT NOT NULL,
  domain          TEXT NOT NULL,
  -- product | engineering | marketing | business | design
  topic           TEXT NOT NULL,
  decision        TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  alternatives    TEXT,           -- JSON: [{option, tradeoff}]
  made_by         TEXT NOT NULL,
  -- agent | ceo | agent-timeout | ceo-override
  impact          TEXT NOT NULL,  -- low | medium | high
  reversibility   TEXT NOT NULL,  -- easy | hard | permanent
  supersedes      TEXT REFERENCES decisions(id),
  tags            TEXT            -- JSON: string[]
);

CREATE TABLE IF NOT EXISTS escalations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  domain            TEXT NOT NULL,
  topic             TEXT NOT NULL,
  draft_decision    TEXT NOT NULL,
  draft_rationale   TEXT NOT NULL,
  draft_alternatives TEXT,        -- JSON: [{option, tradeoff}]
  impact            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  timeout_at        TEXT NOT NULL,
  resolved_at       TEXT,
  resolved_by       TEXT,         -- ceo | timeout
  resolution        TEXT          -- founder's decision text if overridden
);

-- APPEND ONLY.
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  timestamp   TEXT NOT NULL,
  event       TEXT NOT NULL,
  -- decision-made | escalation-created | escalation-resolved
  -- override-logged | engine-run-started | engine-run-complete
  -- engine-run-failed | stage-advanced | capability-executed
  -- artifact-created | recovery-triggered
  detail      TEXT NOT NULL       -- JSON: event-specific payload
);

CREATE TABLE IF NOT EXISTS engine_runs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id),
  started_at          TEXT NOT NULL,
  completed_at        TEXT,
  status              TEXT NOT NULL DEFAULT 'running',
  -- running | complete | failed | recovered
  decisions_made      INTEGER DEFAULT 0,
  escalations_created INTEGER DEFAULT 0,
  actions_executed    INTEGER DEFAULT 0,
  summary             TEXT,
  error               TEXT
);

-- ── Capabilities ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capabilities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL,
  -- deployment | marketing | communication
  -- infrastructure | payments | custom
  description   TEXT NOT NULL,
  setup_guide   TEXT NOT NULL,    -- Markdown shown in configure UI
  config_schema TEXT NOT NULL,    -- JSON Schema: drives credential form
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_actions (
  id                TEXT PRIMARY KEY,
  capability_id     TEXT NOT NULL REFERENCES capabilities(id),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  action_type       TEXT NOT NULL, -- bash | http | playwright
  script            TEXT NOT NULL, -- script text or HTTP config JSON
  param_schema      TEXT,          -- JSON Schema: params agent provides
  is_destructive    INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 0,
  UNIQUE(capability_id, name)
);

CREATE TABLE IF NOT EXISTS project_capabilities (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  capability_id     TEXT NOT NULL REFERENCES capabilities(id),
  credentials_enc   TEXT,          -- AES-256-GCM ciphertext (base64)
  credentials_iv    TEXT,          -- GCM IV (base64, not secret)
  credentials_tag   TEXT,          -- GCM auth tag (base64)
  status            TEXT NOT NULL DEFAULT 'pending',
  -- pending | configured | active | error | revoked
  last_tested_at    TEXT,
  last_test_status  TEXT,          -- success | failure
  last_test_output  TEXT,
  configured_at     TEXT,
  notes             TEXT,
  UNIQUE(project_id, capability_id)
);

-- APPEND ONLY.
CREATE TABLE IF NOT EXISTS capability_executions (
  id                    TEXT PRIMARY KEY,
  project_capability_id TEXT NOT NULL REFERENCES project_capabilities(id),
  action_id             TEXT NOT NULL REFERENCES capability_actions(id),
  params                TEXT,         -- JSON (never credentials)
  triggered_by          TEXT NOT NULL, -- agent | founder-test
  executed_at           TEXT NOT NULL,
  status                TEXT NOT NULL, -- success | failure | timeout
  output                TEXT,          -- stdout, truncated to 4KB
  error                 TEXT,          -- stderr, truncated to 4KB
  duration_ms           INTEGER
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id                    TEXT PRIMARY KEY,
  project_capability_id TEXT NOT NULL REFERENCES project_capabilities(id),
  captured_at           TEXT NOT NULL,
  trigger               TEXT NOT NULL,
  -- pre-action | post-action | scheduled | manual | on-configure
  state                 TEXT NOT NULL, -- JSON: service-specific structure
  raw_response          TEXT,          -- original response (debugging only)
  triggered_by_execution TEXT REFERENCES capability_executions(id)
);

-- ── Artifacts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  type            TEXT NOT NULL,
  -- code-snapshot | git-bundle | account-state | deployed-config
  -- generated-content | environment-snapshot | build-output
  name            TEXT NOT NULL,
  description     TEXT,

  -- Content: exactly one of these two patterns
  content         TEXT,            -- inline: text or compressed+base64
  content_encoding TEXT,           -- null | gzip+base64
  blob_hash       TEXT,            -- if large: SHA-256 → blob store
  content_size    INTEGER NOT NULL, -- uncompressed bytes
  content_hash    TEXT NOT NULL,   -- SHA-256 of uncompressed content

  metadata        TEXT,            -- JSON: type-specific context
  snapshot_of     TEXT,            -- what was captured (path, URL, etc.)
  supersedes      TEXT REFERENCES artifacts(id),
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,   -- agent | founder | system

  CHECK ((content IS NOT NULL) != (blob_hash IS NOT NULL))
);

-- ── Onboarding ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  project_id   TEXT REFERENCES projects(id)
);

-- APPEND ONLY.
CREATE TABLE IF NOT EXISTS onboarding_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES onboarding_sessions(id),
  role       TEXT NOT NULL,   -- user | assistant
  content    TEXT NOT NULL,
  timestamp  TEXT NOT NULL
);

-- ── Indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_decisions_project
  ON decisions(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_topic
  ON decisions(project_id, domain, topic, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_open
  ON escalations(project_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_activity_project
  ON activity_log(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_engine_runs_project
  ON engine_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_project
  ON project_capabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_pc
  ON capability_executions(project_capability_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_pc
  ON account_snapshots(project_capability_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_project
  ON artifacts(project_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_hash
  ON artifacts(content_hash);
```

-----

## 7. Engine

### 7.1 How It Works

The engine is a Claude Agent SDK session that runs on a configurable interval. It reads the current project state, reasons about what decisions are missing, and either makes them autonomously or escalates them to the founder.

The founder is never on the critical path. Escalations have a configurable timeout (default 48h). If no response arrives, the agent's draft recommendation is logged as `agent-timeout`. Work continues.

### 7.2 Scheduler

```typescript
// src/engine/scheduler.ts

class Scheduler {
  constructor(private config: SchedulerConfig, private repo: IFoundryRepository) {}

  start() {
    // Recover stalled runs on startup
    this.repo.engineRuns.recoverStalledRuns();
    setInterval(() => this.tick(), this.config.intervalMs);
  }

  async runNow(projectId: string): Promise<void> {
    const project = this.repo.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    await this.runProject(project);
  }

  private async tick() {
    const active = this.repo.projects.list('active');
    const runnable = active.filter(p => this.needsRun(p));

    await Promise.all(
      runnable
        .slice(0, this.config.maxParallel)
        .map(p => this.runProject(p).catch(err => console.error(...)))
    );
  }

  private async needsRun(project: Project): Promise<boolean> {
    const current = this.repo.engineRuns.getCurrent(project.id);
    if (current?.status === 'running') return false;

    const last = this.repo.engineRuns.getLastCompleted(project.id);
    if (!last) return true;

    const elapsed = Date.now() - new Date(last.completedAt!).getTime();
    return elapsed > this.config.intervalMs;
  }
}
```

### 7.3 Agent SDK Session

> ⚠️ Updated 2026-04-04: The original design referenced a `ClaudeSDKClient` class with a `connect()` streaming interface. The actual SDK uses the `query()` async generator function. `permissionMode: 'acceptEdits'` silently blocks MCP tool calls; `'bypassPermissions'` is required.

```typescript
// src/engine/engine.ts

export async function runEngine(project: Project, repo: IFoundryRepository): Promise<RunSummary> {
  const run = repo.engineRuns.start(project.id);
  const toolServer = buildFoundryToolServer(project.id, repo, run.id);

  try {
    const q = query({
      prompt: buildInitialPrompt(project),
      options: {
        systemPrompt: buildEnginePrompt(project),
        mcpServers: { foundry: toolServer.mcpConfig },
        tools: [],                              // disable built-in tools
        permissionMode: 'bypassPermissions',    // required for MCP tools to execute
        allowDangerouslySkipPermissions: true,  // required alongside bypassPermissions
        maxTurns: 50,
        persistSession: false,
      },
    });

    for await (const message of q) {
      if (message.type === 'result') {
        if (message.subtype !== 'success') throw new Error(`Engine error: ${message.subtype}`);
        break;
      }
    }

    const summary = toolServer.getSummary();
    repo.engineRuns.complete(run.id, summary);
    return summary;
  } catch (err) {
    repo.engineRuns.fail(run.id, String(err));
    throw err;
  }
}
```

### 7.4 Agent Tools

The engine agent has exactly five tools exposed via an in-process MCP server (`createSdkMcpServer`). The agent cannot do anything not expressed by these tools.

```typescript
// src/engine/tools.ts — in-process MCP server via createSdkMcpServer()

get_project_context(project_id: string)
// Returns: { brief, decisions, open_escalations, capabilities }
// Agent calls this first on every run.

log_decision(args: {
  project_id: string;
  domain: 'product' | 'engineering' | 'marketing' | 'business' | 'design';
  topic: string;
  decision: string;
  rationale: string;
  alternatives: Array<{ option: string; tradeoff: string }>;
  impact: 'low' | 'medium' | 'high';
  reversibility: 'easy' | 'hard' | 'permanent';
  supersedes?: string;
  tags?: string[];
})
// Writes to decisions table + activity_log.

create_escalation(args: {
  project_id: string;
  domain: string;
  topic: string;
  draft_decision: string;
  draft_rationale: string;
  draft_alternatives: Array<{ option: string; tradeoff: string }>;
  impact: 'low' | 'medium' | 'high';
  timeout_hours?: number;          // default: 48
})
// Writes to escalations table + activity_log.

execute_capability_action(args: {
  project_capability_id: string;
  action_name: string;
  params: Record<string, string>;
})
// If not configured: creates escalation with setup_guide, returns { escalation_created: true }
// If requires_approval: creates escalation, returns { approval_pending: true }
// Otherwise: delegates to repo.capabilities.execute(), returns { success, output, error }

snapshot_code(args: {
  project_id: string;
  repo_path: string;
  trigger: string;            // 'pre-deploy' | 'post-deploy' | 'agent-run-complete' | 'manual'
})
// Creates git bundle artifact. Called pre/post deploy.
```

### 7.5 System Prompt

The system prompt is a function that takes project context, not a static string (`src/engine/prompts.ts`):

```typescript
function buildEnginePrompt(project: Project): string {
  return `You are the Foundry engine — an autonomous project decision-maker
for a solo founder.

Project: ${project.name}
Brief: ${project.brief.tagline}

Your job on each run:

1. Call get_project_context to load the current state of the project.

2. Identify decision gaps: areas that are unaddressed, underdeveloped,
   or where earlier decisions have downstream implications not yet handled.
   Consider all domains: product, engineering, marketing, business, design.

3. For each gap, determine whether you can decide it autonomously:
   YOU CAN DECIDE: technical tradeoffs, conventions, patterns, sequencing,
   best practices, standard approaches with clear rationale.
   YOU CANNOT DECIDE: founder preferences, budget, personal strategic bets,
   existing relationships, things requiring information you don't have.

4. When deciding: be concrete. State the decision, why, and what you
   considered. Impact and reversibility matter — be accurate.

5. When escalating: always provide your recommendation, not just a question.
   The founder approves or overrides, they do not research from scratch.

6. Prioritize: high-impact before low-impact. Don't make low-impact decisions
   while high-impact ones in the same domain are unresolved.

7. Act on available capabilities: if the project needs code deployed or
   content posted and the capability is configured, do it.

8. Do not re-decide what is already decided unless you have new information
   that materially changes the analysis.

Stop when no actionable gaps remain for this run.`;
}
```

### 7.6 Dynamic Planning

There is no hardcoded stage pipeline. The agent reads the project brief and all existing decisions, then determines what decisions are missing using its own judgment.

This means:

- A SaaS product and a CLI tool take different decision paths
- The agent handles project-specific decisions a fixed pipeline would miss
- As the project matures, the agent's focus shifts naturally (early: product/engineering; later: marketing/business)
- The founder can influence focus by overriding decisions with different priorities

**Tradeoff:** Behavior is less predictable than a fixed pipeline. Mitigated by the decision log — every agent decision is logged with full rationale, making reasoning auditable and overridable.

### 7.7 Crash Recovery

On startup, `repo.engineRuns.recoverStalledRuns()` finds any runs with `status = 'running'` and marks them `failed`. This handles crashes and forced restarts cleanly. The scheduler will schedule the project for a fresh run on the next tick.

-----

## 8. Capability System

### 8.1 Mental Model

A **capability** is a reusable integration template stored in the database: what credentials it needs, what actions it can perform, and how to set it up. A **project capability** is an instance of that template for a specific project: the actual (encrypted) credentials, the current status, and the execution history.

No code changes are required to add a new integration. Everything — scripts, schemas, setup instructions — is data in the database, managed from the UI.

### 8.2 Capability Definitions

Each capability has:

- **`config_schema`**: a JSON Schema object that defines what credentials are needed. This schema drives the credential form in the UI — field labels, types (text, password, URL), required vs optional. The UI generates the form dynamically from this schema.
- **`setup_guide`**: Markdown instructions shown to the founder when configuring the capability. Tells them exactly what to create, where, and what permissions to grant.
- **`capability_actions`**: named actions the agent can call. Each action has a type (`bash`, `http`, `playwright`) and a script or config stored as text.

### 8.3 Action Types

**HTTP** — Structured JSON config. No shell involved. No injection risk. Covers the majority of REST API calls.

```json
{
  "method": "POST",
  "url": "https://api.github.com/repos/{{CRED_USERNAME}}/{{PARAM_REPO}}/issues",
  "headers": {
    "Authorization": "token {{CRED_TOKEN}}",
    "Content-Type": "application/json"
  },
  "body": {
    "title": "{{PARAM_TITLE}}",
    "body": "{{PARAM_BODY}}"
  }
}
```

**Bash** — Script stored as text, executed via `child_process.spawn`. Credentials injected as env vars prefixed with `CRED_`. Parameters prefixed with `PARAM_`. Use for CLI tools (fly, npm, git) and operations not available via HTTP.

**Playwright** — Script stored as text, executed via `npx playwright run`. For browser-based actions where no API exists. Last resort due to fragility.

**Security note on Bash scripts:** Scripts are founder-authored and founder-reviewed. The agent cannot modify scripts, only execute them. Parameters injected via environment variables, not shell interpolation — no injection risk from `PARAM_` values. However, scripts themselves should be audited before use. The custom capability UI should make scripts clearly visible and editable.

### 8.4 Credential Security

Credentials are encrypted with AES-256-GCM before writing to the database.

- **Key**: 32 bytes (256 bits), stored only in `FOUNDRY_ENCRYPTION_KEY` env var. Never in the database.
- **IV**: 12 bytes, generated fresh for every write. Stored in database (not secret, must be unique).
- **Auth tag**: 16 bytes. Stored in database. Verifies ciphertext integrity on decrypt — tampered credentials will fail to decrypt rather than silently returning garbage.

The credential lifecycle:

```
saveCredentials() → encrypt → store (enc, iv, tag) in DB
execute() → load (enc, iv, tag) → decrypt in memory → inject as env vars
         → subprocess runs → env vars discarded with process
         → clear credentials object from memory
```

**Credentials are write-only from the caller's perspective.** No API route returns decrypted credentials. No agent tool returns credential values. No execution log contains credential values.

### 8.5 Execution Flow

```typescript
// Inside repo.capabilities.execute():

1. Load project_capability — verify status === 'active'
2. Decrypt credentials (AES-256-GCM, verify auth tag)
3. Load action from capability_actions
4. Validate params against param_schema
5. Run action by type:
   - bash: child_process.spawn(script, { env: { ...CRED_*, ...PARAM_* } })
   - http: fetch with template interpolation
   - playwright: npx playwright run tmpScript.js
6. Capture stdout/stderr (truncated to 4KB each)
7. Wipe credentials object
8. Append to capability_executions (no credentials)
9. Optionally capture account state (post-action snapshot)
10. Return ExecutionResult to caller
```

### 8.6 Built-in Capability Library

Seeded on first run via `src/engine/seed.ts`. Founder never needs to define these — just configure them.

|Capability  |Category      |Key Actions                                                     |
|------------|--------------|----------------------------------------------------------------|
|GitHub      |infrastructure|create-repo, push-branch, create-pr, create-issue, capture-state|
|Fly.io      |deployment    |deploy, set-secret, scale, capture-state                        |
|Vercel      |deployment    |deploy, set-env, capture-state                                  |
|Railway     |deployment    |deploy, set-env, capture-state                                  |
|Twitter/X   |marketing     |post, reply, capture-analytics                                  |
|Linear      |infrastructure|create-issue, update-status, create-project                     |
|Slack       |communication |post-message, create-channel                                    |
|Email (SMTP)|communication |send                                                            |
|npm         |infrastructure|publish, deprecate                                              |
|Stripe      |payments      |create-product, create-price, create-checkout                   |
|AWS S3      |infrastructure|upload, make-public, list                                       |

Seeding is idempotent — safe to run on every startup.

### 8.7 Custom Capabilities

Founders can define capabilities entirely from the UI:

1. Name, category, description
1. Setup guide (Markdown textarea)
1. Credential fields: add/remove, type (text/password/url), required/optional
1. Actions: name, description, type (HTTP form or Bash/Playwright code editor)
1. Parameter fields the agent must provide per action
1. Destructive flag, requires-approval flag

Saved to database immediately. Agent can use on next run.

### 8.8 Capability Hub UI

`/[projectId]/capabilities`:

```
Active (3)          Pending Setup (2)       Available (8+)
──────────          ─────────────────       ──────────────
✓ GitHub            ⏳ Fly.io → [Configure] + Twitter/X
✓ Linear            ⏳ Email → [Configure]  + Slack
✓ npm                                       + Stripe
                                            + [Create custom...]
```

Configure flow:

1. Click pending capability
1. See rendered `setup_guide` Markdown
1. Fill credential form (generated from `config_schema`)
1. Click "Save & Test" — runs test action, shows result
1. If success: status → `active`. Agent uses it next run.
1. If failure: status → `error`, test output shown inline.

-----

## 9. Artifact System

### 9.1 Purpose

Remote services fail, accounts get banned, servers get migrated. Foundry captures the artifacts needed to recover: code at deploy time, account state, generated content, environment configs.

**The goal:** copy `foundry.db` + `foundry.blobs/` + `.env` to a new server and resume with minimal manual intervention.

### 9.2 Storage Strategy

Two-tier:

- **Inline in SQLite** (compressed): artifacts below the size threshold (default 50MB uncompressed). Stored as gzip+base64 in the `content` column.
- **Blob store** (`foundry.blobs/`): artifacts above the threshold. Stored as files named by SHA-256 content hash. The database holds the hash; the blob store holds the content.

```
foundry.blobs/
  ab/
    cd1234abcd...    ← file named by full SHA-256
  ef/
    9876efab...
```

The routing is internal to the repository. Callers use `artifacts.store()` and `artifacts.get()` without knowing which tier stored the content.

### 9.3 Code Snapshots (Git Bundles)

A git bundle is a single file containing a repository's full history, all branches, all tags. It can be cloned:

```bash
git clone /path/to/snapshot.bundle ./recovered-repo
```

`artifacts.snapshotCode()` internally:

1. Runs `git bundle create /tmp/snap.bundle --all` in the repo path
1. Compresses with gzip
1. Routes to inline or blob store based on size
1. Stores metadata: trigger, branch, commit hash

**Snapshot triggers:** `pre-deploy`, `post-deploy`, `agent-run-complete`, `manual`

**Snapshot retention:** keep the last 10 per project per trigger type. Older ones are marked superseded and garbage collected after 30 days. Never delete the most recent.

### 9.4 Account State

After key capability executions, the agent captures what the external service contains. Secrets lists contain names, never values.

### 9.5 Generated Content

Marketing copy, emails, social posts — stored as `generated-content` artifacts. If the Twitter account is suspended, the content archive is in the database.

-----

## 10. UI

### 10.1 Role

The UI is an observation and override interface. It contains no business logic. It reads from the API, displays state, and writes only two things: escalation resolutions and new projects (from onboarding).

The engine does not wait for the UI. The UI reflects what has happened; it does not drive what happens next.

### 10.2 Views

**State of World** (`/[projectId]/world`)

The latest decision per unique topic across all domains. Filterable by domain. Includes a "▷ run" button that triggers an immediate engine run via `POST /api/admin/run/:projectId`. The button shows a green pulse and "running" label while a run is active (polls `/api/admin/runs/:projectId` every 5s).

**Activity Feed** (`/[projectId]/activity`)

The `activity_log` in reverse chronological order. The engine's heartbeat. Shows decisions made, escalations created and resolved, capability executions, artifact snapshots.

**Decision Log** (`/[projectId]/log`)

The full append-only decision history. Filterable by domain, impact, and `made_by`. Tap to expand shows rationale and alternatives considered.

**Capabilities Hub** (`/[projectId]/capabilities`)

Grouped by status (Active / Pending / Available). Configure flow and execution log per capability. Custom capability editor.

**Artifacts** (`/[projectId]/artifacts`)

List of code snapshots, generated content, environment captures.

### 10.3 Escalation Banner and Modal

The escalation banner is always visible at the top of every view when an open escalation exists. The number on the "World" nav item shows the count. Tapping "Review" opens the escalation modal.

The modal:

- Shows the agent's recommendation prominently
- Shows rationale and alternatives considered
- Three actions: **Accept**, **Override** (text input), **Delay 24h**
- Shows the auto-accept countdown
- On any action: `POST /api/escalations/:id/resolve` → engine picks up next tick

### 10.4 Mobile Design

The UI is mobile-first. Key mobile decisions:

- Bottom navigation (not sidebar)
- Cards instead of tables for the decision log
- Bottom sheet modal (not centered dialog) for escalations
- Horizontally scrollable filter chips (no wrapping)
- `100dvh` via custom `h-dvh` Tailwind utility for iOS Safari address bar handling
- Touch targets ≥ 44px

-----

## 11. Onboarding

### 11.1 Flow

New projects are created through a chat interface, not a form. The agent asks questions, infers what it can, and generates a structured product brief. This brief is the foundation all subsequent agent decisions draw from.

```
/ → [+ New Project] → /new → session created → /new/:sessionId
  → conversation
  → Claude outputs <brief> XML
  → UI renders Approve button inline
  → Approve → POST /api/onboarding/approve → redirect to /[projectId]/world
  → Engine picks up on next tick
```

### 11.2 Session Persistence and API

Onboarding conversations are stateless per HTTP request — the server has no session memory. Each message request reconstructs the full conversation history from the database, formats it as a transcript, and sends it to Claude as the prompt with `maxTurns: 1`.

```
POST /api/onboarding/sessions          ← create session, get opening message
GET  /api/onboarding/sessions/:id      ← load session + all messages
POST /api/onboarding/sessions/:id/message ← send user message, get AI reply
POST /api/onboarding/approve           ← create project from brief, complete session
```

Resumption: the session ID is in the URL (`/new/:sessionId`). Closing and reopening the browser resumes the conversation from the same point.

### 11.3 Onboarding Agent Behavior

The onboarding system prompt instructs Claude to:

- Ask the minimum questions necessary — typically 5–8 exchanges
- Never ask more than one question per response
- State assumptions rather than ask about low-stakes details
- Follow up when an answer is vague and the answer materially affects the brief

When enough context exists, Claude outputs the brief as XML inside `<brief>` tags embedded in the response. The UI parses this with a regex-based parser (not a full XML parser) and renders the brief inline with an approve button.

```xml
<brief>
  <n>Snapquery</n>
  <tagline>Fast, drag-and-drop data exploration with SQL for anyone</tagline>
  <problem>...</problem>
  <user>...</user>
  <mvp>...</mvp>
  <constraints>...</constraints>
  <existing>Prior implementation exists; this is a reimplementation</existing>
  <assumptions>
    <assumption>DuckDB WASM runs in-browser; no server-side query execution needed</assumption>
  </assumptions>
</brief>
```

-----

## 12. Admin API

The admin API was added during Phase 6 to expose operational controls that needed scheduler access. It is mounted at `/api/admin`.

### 12.1 Endpoints

```
POST /api/admin/run/:projectId
  ← Triggers an immediate engine run (fire-and-forget).
  ← Returns { queued: true } immediately. Run happens in background.
  ← 409 if a run is already in progress.

GET  /api/admin/runs/:projectId
  ← Returns { current: EngineRun | null, last: EngineRun | null }.
  ← Used by the WorldView "▷ run" button to poll run status.

POST /api/admin/backup
  ← Body: { path?: string, compress?: boolean }
  ← Triggers repo.backup(). Returns BackupResult.
  ← If no path provided, saves to $FOUNDRY_DATA_DIR/backup-{timestamp}.tar.gz.
```

### 12.2 Design Note

There is no authentication on these endpoints (consistent with the rest of the API in v1 — trusted local network). The admin routes are separated from the main routes because they require a reference to the `Scheduler` instance, which the main routes don't need.

-----

## 13. Security

### 13.1 Threat Model (V1)

Foundry runs on a home server on a private network. The primary threat model is:

- **Data loss**: mitigated by backups and the self-contained persistence model
- **Credential exposure**: mitigated by AES-256-GCM encryption with key stored only in env var
- **Accidental destructive action**: mitigated by `requires_approval` flag on destructive capability actions
- **Backup theft**: the backup archive is readable without the encryption key for metadata, but credentials are encrypted with GCM — backups are safe to store on untrusted media

What is **not** in scope for v1:

- Authentication and authorization (no auth, trusted network assumed)
- TLS between services (Nginx handles TLS termination)
- Rate limiting or abuse protection

### 13.2 Credential Encryption

AES-256-GCM provides both encryption (confidentiality) and authentication (integrity). The auth tag means a tampered ciphertext fails to decrypt — it does not silently produce garbage plaintext.

Key generation (performed once at setup):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → add result to .env as FOUNDRY_ENCRYPTION_KEY
```

The key is 32 bytes (256 bits), stored only in environment variable, never logged or returned via API, and must be backed up separately from the database. **If the key is lost, credentials cannot be recovered.** The rest of the database is unaffected.

### 13.3 Script Injection

Bash action scripts use environment variables for parameters, not shell string interpolation. Env vars are set via `child_process.spawn(cmd, args, { env: { ... } })`. The shell never sees parameter values directly.

### 13.4 Agent Access

The engine agent has exactly five tools. It cannot read or modify capability scripts, read decrypted credentials, delete decisions or artifacts, access the filesystem directly (built-in Agent SDK tools are disabled), or make outbound network calls except via `execute_capability_action`.

-----

## 14. Operational

### 14.1 Deployment

```
Home server
├── Nginx (port 80/443)
│   ├── Redirects HTTP → HTTPS
│   └── Proxies all traffic → localhost:3001
└── Node.js process (port 3001, managed by PM2)
    ├── Express API (/api/*)
    ├── Static React build (ui/dist/)
    ├── Engine scheduler (background setInterval)
    └── SQLite + blob store
```

### 14.2 Configuration

```bash
# .env — required
FOUNDRY_ENCRYPTION_KEY=<64-char hex>  # 32 bytes, AES-256-GCM key

# Paths (defaults shown)
DB_PATH=./foundry.db
BLOB_DIR=./foundry.blobs
BLOB_THRESHOLD_MB=50

# Server
PORT=3001

# Engine
ENGINE_INTERVAL_MINUTES=10

# Optional
ESCALATION_TIMEOUT_HOURS=48
MAX_PARALLEL_PROJECTS=1
```

**Authentication:** Claude Max subscription credentials are used via the Claude CLI's existing auth. No `ANTHROPIC_API_KEY` is needed in `.env`. The Agent SDK picks up the CLI credentials automatically.

### 14.3 PM2 Configuration

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'foundry',
    script: 'dist/index.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env_file: '.env',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }],
};
```

Start: `mkdir -p logs && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`

### 14.4 Backup Strategy

**Automated:** nightly cron job runs `scripts/backup.sh`:

```bash
# crontab -e
0 3 * * * /home/terry/foundry/scripts/backup.sh
```

`scripts/backup.sh` calls `POST /api/admin/backup`, saves to `~/foundry-backups/`, and auto-prunes to 14 most recent backups.

**Manual:** `POST /api/admin/backup` with optional `{ path }` body.

**Retention:** 14 daily backups kept by default (configurable in the script).

### 14.5 Server Migration

```bash
# 1. Backup on source server
curl -X POST http://localhost:3001/api/admin/backup \
  -H "Content-Type: application/json" \
  -d '{"path": "/tmp/foundry-migration.tar.gz"}'

# 2. Transfer
scp /tmp/foundry-migration.tar.gz user@newserver:~/

# 3. On new server: restore
./scripts/restore.sh ~/foundry-migration.tar.gz ~/foundry

# 4. Start
pm2 start ecosystem.config.cjs
```

The engine scheduler recovers stalled runs on startup. The first tick after restore picks up where the engine left off.

### 14.6 Health Check

`GET /api/health` returns:

```json
{
  "status": "ok",
  "db": { "ok": true, "sizeBytes": 4200000, "integrityOk": true },
  "blobs": { "ok": true, "count": 14, "totalBytes": 180000000 },
  "encryption": { "ok": true }
}
```

### 14.7 Size Management

**Database:** SQLite handles up to several GB on modern hardware without performance issues for this access pattern. Monitor size via health check.

**Blob store:** large git bundles accumulate here. Retention policy: 10 snapshots per trigger type per project, GC after 30 days. Configurable.

**Log tables:** `activity_log`, `capability_executions`, `onboarding_messages` grow unboundedly. Prune with a cron job that deletes rows older than 90 days from `capability_executions` (not a decision log — operational data). Never prune `decisions`, `activity_log`, or `artifacts`.

-----

## 15. Build Phases

Each phase has a concrete "done when" condition.

### Phase 1 — Repository and Infrastructure ✓

Build the data layer first. Everything else depends on it.

**Done:** `npm start` runs. `GET /api/health` returns `{ status: "ok" }`. `repo.backup()` produces a valid archive. `restoreRepository()` produces a working repository from that archive.

-----

### Phase 2 — Engine ✓

**Done:** Engine completes one full session. At least 5 decisions logged across at least 2 domains. At least 1 escalation created. Crash recovery works.

-----

### Phase 3 — API ✓

All REST routes implemented and wired. Override flow (`POST .../resolve`) correctly writes to the database and engine picks it up.

-----

### Phase 4 — UI ✓

All views display live data. Override flow works end-to-end from mobile. Static build served by Express.

-----

### Phase 5 — Onboarding ✓

New projects created through the chat interface. Brief stored correctly. Engine picks it up. Browser close/reopen resumes the conversation.

-----

### Phase 6 — Deployment and Hardening ✓

`ecosystem.config.cjs` for PM2. `nginx.conf` for SSL termination. `scripts/backup.sh` (API-driven, 14-day retention). `scripts/restore.sh` (stops PM2, restores, restarts). `POST /api/admin/backup`, `/run/:id`, `/runs/:id` endpoints.

**Not yet done:**
- Blob store GC script (prune per retention policy)
- `README.md` (setup guide for fresh clone)

-----

## 16. Open Questions

**Onboarding session ownership.** Sessions created before a project exists are not associated with a project. Should abandoned sessions (no `project_id` after 7 days) be pruned? Or kept for reference?

**Capability action versioning.** If a built-in action script is updated (e.g., the GitHub API changes), existing `project_capabilities` reference the old action. Should actions be versioned, or should updates propagate automatically?

**Multi-project engine behavior.** With `MAX_PARALLEL_PROJECTS > 1`, two engine runs share one Claude Max subscription session limit. Are there API-level constraints on concurrent Agent SDK sessions that need handling?

**Manual escalation timeout extension.** The UI has a "Delay 24h" button on the escalation modal. Should this be a free-form duration, a preset list, or a fixed 24h extension?

**Artifact pruning UI.** Retention policy is configured in `.env` but there is no UI for viewing artifact disk usage or manually pruning. Is this needed in v1 or deferred?

**Health check engine status.** The health response does not currently include engine run status or last backup time (shown in the original design spec). These would be useful additions.

-----

## Appendix A: Document Maintenance

### A.1 When to Update This Document

Update this document when:

- A design decision is made that changes the architecture, schema, API, or behavior described here
- An open question is resolved
- A build phase completes and the "done when" condition is verified
- A tradeoff is revisited and a different choice is made

Do not update this document to reflect implementation details that don't affect the design (e.g., which utility functions were written, how a component is styled). Those belong in code comments or READMEs.

### A.2 How to Update

**Changing a decision:** do not edit the original section in place without leaving a trace. Add a note at the top of the affected section:

```
> ⚠️ Updated [date]: [brief description of change]. See [section X] for prior decision.
```

Then update the section content. If the prior decision is still useful context, move it to an "Alternatives considered" subsection rather than deleting it.

**Resolving an open question:** move the question from Section 16 to the relevant section with a decision header:

```
### Decision (resolved [date])
[The question that was open]
**Decision:** [what was decided]
**Rationale:** [why]
```

**Adding a new system or component:** add a new top-level section. Update the Table of Contents. Follow the progressive disclosure structure: overview first, interface second, internals third, tradeoffs last.

### A.3 Structure Conventions

**Progressive disclosure:** every section follows this order:

1. What it is and why it exists (1–3 sentences)
1. The public interface or behavior as seen from outside
1. Internal design or implementation approach
1. Tradeoffs, alternatives, and known limitations

**Tradeoffs are explicit:** when a choice is made between two reasonable options, document the tradeoff. "We chose X over Y because Z" is required. Undocumented choices are invisible to future contributors and to the founder reviewing the design.

**Code samples are illustrative, not normative:** code in this document shows the shape and intent of an interface. The implementation may differ in detail; what matters is the interface contract and the design intent.

-----

## Appendix B: Conventions and Preferences

These are the founder's stated preferences and discovered constraints from the build process. The coding agent should treat them as standing constraints unless explicitly overridden.

### B.1 Code Style

- **Concise over verbose.** No unnecessary lines. No wrapper functions that exist only to rename another function.
- **Readable naming.** Variable and function names should make the code read like prose at the call site. Abbreviations only when universal (e.g., `id`, `db`, `err`).
- **No contrived abstraction.** A function, class, or module earns its existence by having a clear, singular responsibility.
- **Default to simple.** The first working solution is usually correct. Complexity enters only when the problem demonstrably demands it.
- **TypeScript strict mode with `exactOptionalPropertyTypes: true`.** No `any`. No `as unknown as X`. When passing optional fields, use conditional spread: `...(x !== undefined && { key: x })` rather than passing `undefined` values directly.

### B.2 Architecture Preferences

- **The repository boundary is hard.** No storage detail leaks above `src/repository/`. Enforced by ESLint.
- **The engine is the only writer** to decisions, activity_log, and capability_executions.
- **Capabilities and scripts are data.** No code change required to add an integration.
- **Single process unless the problem demands otherwise.**
- **Async-first.** The founder is never blocked. Escalations time out. The engine continues.

### B.3 UI Preferences

- **Mobile-first, always.** The primary device is a phone. Desktop is a secondary concern.
- **Observation + override only.** The UI reflects state. It does not contain domain logic.
- **Dark, dense, terminal-adjacent.** The aesthetic respects that the user is a builder. Not consumer-y.
- **Fonts:** Syne (headings/labels), JetBrains Mono (metadata/ids/timestamps), Lora (body text).
- **Tailwind color tokens:** `surface-{0-4}` for backgrounds, `text-{primary,secondary,dim}` for text, `accent-{blue,green,amber,red,purple}` for accents. `accent` is an object, not a scalar — use `accent-blue` not `accent`.
- **`h-dvh`** for full-height containers (iOS Safari address bar). Defined as a custom utility.

### B.4 Claude Agent SDK Constraints

These were discovered during the build and must be applied consistently:

- **`permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` are both required** for MCP tool calls to execute. Using `permissionMode: 'acceptEdits'` silently blocks all tool calls — the session runs to completion with 0 tool invocations and no error.
- **`query()` is the correct function**, not a class instantiation. The async generator yields message events; iterate with `for await`.
- **`persistSession: false`** for stateless use cases (onboarding, single-turn requests). The engine also uses this — conversation state is managed through tool calls, not session continuity.
- **`tools: []`** must be set explicitly to disable built-in Agent SDK tools (file read/write, bash, etc.) when using MCP servers only.
- **In-process MCP server** via `createSdkMcpServer()` + `tool()` from the SDK. Tool schemas use zod. `z.record()` in zod v4 requires two arguments: `z.record(z.string(), z.string())`.

### B.5 Dependency Constraints

- **Vite must be pinned to v5** (`npx create-vite@5`). Vite 6+ uses `styleText` from `node:util` which is not available in Node 18, causing build failures at import time.
- **Port 3001** for the Node.js server. Port 3000 conflicts with common development servers on this machine.
- **zod v4** is the installed version. API differences from v3 apply throughout.

### B.6 Operational Preferences

- **Self-contained.** The system must be restorable from `foundry.db` + `foundry.blobs/` + `.env`.
- **Home server deployment.** No cloud-native assumptions. PM2 + Nginx + SQLite.
- **Backup is part of the design, not an afterthought.** Nightly cron, 14-day retention.
- **Low ops burden.** No separate database process. No message queue. No container orchestration.

### B.7 Decision-Making Philosophy

- **Make the decision.** When the agent faces an unresolved question it can reasonably answer, it decides and logs. It does not defer unless the decision genuinely requires founder input.
- **Escalate with a recommendation.** An escalation is not a question. It is a recommendation with a question attached.
- **High-impact before low-impact.** Within a domain, resolve high-impact decisions before moving to low-impact ones.
- **Log everything.** If it was decided, it's in the decision log. If it happened, it's in the activity log.

-----

## Appendix C: Out of Scope for V1

These are explicitly deferred. They are not forgotten — they are candidates for v2 planning.

- **Authentication and authorization.** Single user, trusted network. No auth in v1.
- **Multi-user support.** The data model does not prevent it, but the UI and access control are not designed for it.
- **External notifications.** The founder checks the UI. No Slack, email, or push notifications in v1.
- **Sub-agent parallelism within a project.** Decisions within a single engine run are sequential. Parallel sub-agents per domain is a v2 consideration.
- **The engine writing code.** The engine decides what to build and how, but does not write code. Code writing is the founder's or Claude Code's job. The engine manages the project, not the implementation.
- **Editing a capability action script after use.** Once an action has been executed, its script is referenced in the execution log. Editing it creates a versioning ambiguity. New actions can be created; existing ones should not be edited.
- **Brief editing after project creation.** The brief is the foundation for all agent decisions. Editing it retroactively would invalidate prior decisions. A v2 solution might involve creating a new brief version.
- **Custom capability sharing between projects.** Custom capabilities are currently project-scoped.
- **Capability action versioning.** Version pinning per project capability is a v2 concern.
- **"Backup now" UI button.** Backup is currently triggered via API or cron. A UI button in a settings view was in the original spec but not implemented.
- **Blob store GC script.** Retention policy logic (prune old snapshots) is not yet implemented. Currently blobs accumulate unboundedly.
- **Health check engine/backup fields.** The `/api/health` response doesn't include last engine run status or last backup time as originally specified.
