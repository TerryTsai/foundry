# Foundry — System Design

*Internal codename. Version 1.2. Living document.*

-----

## Table of Contents

1. [Overview](#1-overview)
1. [Principles](#2-principles)
1. [Architecture](#3-architecture)
1. [Tech Stack](#4-tech-stack)
1. [Repository](#5-repository)
1. [Data Model](#6-data-model)
1. [Loop](#7-loop)
1. [Agent System](#8-agent-system)
1. [Project Config](#9-project-config)
1. [Artifact System](#10-artifact-system)
1. [Capability System](#11-capability-system)
1. [UI](#12-ui)
1. [Onboarding](#13-onboarding)
1. [Admin API](#14-admin-api)
1. [Security](#15-security)
1. [Operational](#16-operational)
1. [Build Phases](#17-build-phases)
1. [Open Questions](#18-open-questions)

- [Appendix A: Document Maintenance](#appendix-a-document-maintenance)
- [Appendix B: Conventions and Preferences](#appendix-b-conventions-and-preferences)
- [Appendix C: Out of Scope for V1.2](#appendix-c-out-of-scope-for-v12)

-----

## 1. Overview

### 1.1 What It Is

Foundry is a locally-hosted autonomous project engine for solo founders. It moves a software project forward without requiring the founder's continuous attention. It makes decisions, takes actions, and surfaces only the things that genuinely require human judgment.

The founder's role is not to drive the project. It is to set direction, configure the workforce, and provide input when no agent can proceed without it. Everything else happens autonomously.

### 1.2 The Core Problem

Solo founders lose ideas to analysis paralysis and decision fatigue. Many decisions don't require deep founder input — they require a decision to have been made. But beyond decisions, execution stalls too: code needs to be written, deployments need to happen, content needs to ship.

Foundry removes the founder from the critical path for most decisions and most execution. Agents decide, build, deploy, and market. The founder sets direction and unblocks the rare things that genuinely need a human.

### 1.3 The First Project

Foundry's first project is **Snapquery**: a fast, user-friendly web app for data exploration. Users drag-and-drop files to view, filter, and sort data, or write SQL queries powered by DuckDB. Foundry will manage all decisions and execution for this build.

Foundry also runs itself as a project.

### 1.4 Design Philosophy

Two primitives: **tasks** and **artifacts**. All coordination, state, and output flows through these two things.

The loop is dumb infrastructure. It finds routable tasks and dispatches them to agents. It has no knowledge of what a decision is, what a failure means, or what any artifact contains.

Agents are the intelligence. They are fully project-defined: name, declared inputs and outputs, explicit tools, and a prompt. Adding a new agent type, a new artifact type, or a new recovery strategy requires no code changes — only a project config change.

### 1.5 V1.2 Scope

- Task-driven agent execution: idea to deployed product, end to end
- Fully project-defined agent workforce
- Artifact-based coordination: no shared mutable state between agents
- DAG validation at project creation and task creation time
- Founder as a system-level concept: human tasks surface in the UI, no agent session opened
- Project config as the single source of truth for agent behavior
- Operational hardening (stall detection, retry limits, cycle detection) deferred to v1.3

-----

## 2. Principles

These are not preferences. They are the constraints that govern every technical decision in this codebase. A proposed change that violates one needs explicit justification.

**The founder is never a bottleneck.** The loop runs on its own schedule. Nothing waits for human input indefinitely.

**The loop knows nothing about domain.** The loop routes tasks and records system health. It has no knowledge of what a decision is, what a failure means, or what an artifact contains. All intelligence lives in agents.

**Agents are project data.** No code change is required to add, modify, or remove an agent. Everything — name, consumes, produces, tools, prompt — is stored in the project config.

**Tasks are immutable.** A task is created once and never updated. State is derived entirely from artifact presence. The loop does not maintain a status field.

**Artifacts are the only coordination mechanism.** Agents do not communicate directly. One agent's output is another agent's input, mediated by the artifact store. There is no shared mutable state between agent sessions.

**Everything explicit.** No implicit tool grants. No implicit agent behavior. No system-level magic. If an agent has a capability, it is declared in the project config.

**Storage details do not leak.** Nothing outside `src/repository/` knows that SQLite exists, how credentials are encrypted, what a git bundle is, or where the blob store lives. The repository boundary is enforced by ESLint `no-restricted-imports`. A violation is a build error.

**Append-only for logs.** The activity log and capability execution log are never updated or deleted. Corrections are new entries. The history of what happened is permanent.

**Simple over clever.** The first working solution is usually correct enough. Complexity is introduced only when the problem demonstrably demands it, not in anticipation of problems.

**The system is self-contained.** Copying `foundry.db` + `foundry.blobs/` + the encryption key to a new server resumes all projects. No external state required.

-----

## 3. Architecture

### 3.1 Layers

```
┌──────────────────────────────────────────────────┐
│  UI (React, static build)                        │
│  Observation + override only. No business logic. │
└────────────────────┬─────────────────────────────┘
                     │ HTTP / REST
┌────────────────────▼─────────────────────────────┐
│  API (Express routes)                            │
│  Thin. Validates input, calls repository,        │
│  returns data. No domain logic.                  │
├──────────────────────────────────────────────────┤
│  Loop (Scheduler + Router)                       │
│  Tick rate. Task routing. System observability.  │
│  No domain logic. Calls only the repository.     │
├──────────────────────────────────────────────────┤
│  Agent Runtime (Claude Agent SDK)                │
│  One agent session per task. Stateless per run.  │
│  Tools: declared system tools + project tools.   │
│  Context: project config + task input artifacts. │
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
├── new Scheduler(config, repo)      ← setInterval: ticks the loop
│     scheduler.start()
└── startServer(repo, scheduler, config) ← Express: API + static UI
```

No separate daemon. No separate web server. Express serves both `/api/*` and the static React build from `ui/dist`. Nginx sits in front and handles SSL termination and static file caching.

### 3.3 Data Flow

```
Loop tick
  └── repo.tasks.findRoutable(projectId)
  └── for each routable task:
        if task.agent === 'founder':
          no-op (task surfaces in UI via API poll)
        else:
          build agent context (config + input artifacts)
          open Agent SDK session
          agent calls tools: read_artifact / write_artifact / create_task / compute tools / project tools
          session ends
          loop observes artifact presence on next tick → task state derived

UI polls /api/tasks, /api/artifacts, /api/activity
  └── founder reviews founder task
  └── POST /api/tasks/:id/complete → API writes result artifact
  └── downstream tasks become routable on next tick
```

### 3.4 What the Loop Knows

The loop knows:

- When to tick and at what rate
- Which tasks are routable (all input artifacts exist, output artifacts don't yet)
- Which agent to route a task to (from `task.agent`)
- That `agent: 'founder'` means surface in UI, do not open a session
- That project config should be injected into every agent session as context
- That an output declaration with `isFailure: true` signals a failure output for state derivation
- System health: last run time, tasks dispatched, errors

The loop does not know:

- What a decision is
- What a failure means beyond the `isFailure` flag
- What any artifact contains
- How any agent should behave internally

### 3.5 Source Structure

```
src/
  index.ts
  repository/
    index.ts              ← public interface + factory
    types.ts              ← domain types only
    config.ts             ← RepositoryConfig type
    impl/
      index.ts            ← FoundryRepository class
      backup.ts
      blob-store.ts
      crypto.ts           ← AES-256-GCM (used only in impl/)
      git.ts              ← git bundle operations (used only in impl/)
      executor.ts         ← capability action execution
      stores/
        projects.ts
        tasks.ts          ← immutable task store
        artifacts.ts      ← inline vs blob routing
        capabilities.ts
        activity.ts
        loop-runs.ts
        onboarding.ts
        project-config.ts ← config versions + DAG validation
      schema/
        index.ts          ← Drizzle table definitions
        migrations/
  loop/
    scheduler.ts          ← tick rate, project iteration
    router.ts             ← task dispatch, agent context construction
  agents/
    runtime.ts            ← Agent SDK session management
    context.ts            ← system prompt + input artifact assembly
    tools/
      system.ts           ← read_artifact, write_artifact, create_task
      compute.ts          ← run_command, read_file, write_file (workspace-scoped)
      project.ts          ← capability action tool resolution
  api/
    routes/
      projects.ts
      tasks.ts
      artifacts.ts
      capabilities.ts
      activity.ts
      onboarding.ts
      config.ts
      admin.ts
      health.ts
  ui/                     ← React + Vite (static build)
```

-----

## 4. Tech Stack

|Layer          |Choice                          |Reason                                                            |
|---------------|--------------------------------|------------------------------------------------------------------|
|Runtime        |Node.js 18+ (TypeScript)        |Long-running process, async-native, Agent SDK is TypeScript-first |
|Agent          |`@anthropic-ai/claude-agent-sdk`|Powers agent sessions; authenticates via Claude Max subscription  |
|Web server     |Express                         |Thin, well-understood; serves API + static files                  |
|Database       |SQLite via Drizzle ORM          |Single file, zero-ops, full SQL, type-safe schema, easy migrations|
|Blob store     |Content-addressed filesystem    |Large artifacts stored by SHA-256 hash; simple to rsync           |
|Encryption     |Node.js `crypto` (AES-256-GCM)  |Built-in, auditable, no third-party credential handling           |
|UI             |React + Vite 5                  |Static build served by Express; Vite proxies to API in dev        |
|Styling        |Tailwind CSS v3                 |Matches approved mockups; no runtime overhead                     |
|Process manager|PM2                             |Restart on crash, startup on boot, simple log management          |
|Reverse proxy  |Nginx                           |SSL termination, static file caching                              |
|DAG validation |In-process TypeScript           |Simple graph traversal over project config; no library needed     |

### 4.1 Tradeoffs

**SQLite over Postgres.** Postgres adds an ops burden not justified for a single-user local tool. SQLite's single-file model enables the portability guarantee. If this becomes multi-user or high-write, migrating is a repository-internal change — nothing outside `src/repository/` changes.

**Single process over daemon + web server.** The loop runs as a `setInterval` background job in the same process as Express. Simpler to reason about, simpler to deploy, simpler to debug.

**Two primitives (tasks + artifacts) over a richer domain model.** Decisions, escalations, and work items are all unified under tasks and artifacts. Adding a new concept requires a project config change, not a schema change. The cost is that the system has no built-in opinion about what decisions or failures mean — that responsibility falls to agent prompts and project configuration.

**Dumb loop over intelligent orchestrator.** A loop that understands domain logic is predictable but rigid. A dumb loop that routes tasks to agents is flexible but requires well-designed agent prompts. The tradeoff is that system behavior is less immediately obvious from the loop code — mitigated by the activity log and DAG view making execution visible.

**One active agent at a time.** Parallel agent sessions would require solving artifact write conflicts and concurrent Claude Max subscription usage. Deferred to v1.3. The single-agent constraint makes the system easy to reason about and debug.

**Agent SDK `query()` over raw Anthropic API.** The SDK provides the agent loop, tool use infrastructure, in-process MCP server support, and subscription-based auth. The raw API would require building all of this manually.

-----

## 5. Repository

### 5.1 Purpose and Boundary

The repository is the single interface to all persistence in Foundry. Its job is to translate between the domain language (projects, tasks, artifacts, capabilities) and the storage mechanisms (SQLite, filesystem, encryption).

**Nothing outside `src/repository/` may import:**

- `drizzle-orm` or `better-sqlite3`
- `node:crypto`
- Git operations (`child_process` for git bundle)
- Blob store path operations

Enforced via ESLint `no-restricted-imports`. A violation is a build error.

### 5.2 Public Interface

```typescript
// src/repository/index.ts

export interface IFoundryRepository {
  readonly projects:      IProjectRepository;
  readonly tasks:         ITaskRepository;
  readonly artifacts:     IArtifactRepository;
  readonly capabilities:  ICapabilityRepository;
  readonly activity:      IActivityRepository;
  readonly loopRuns:      ILoopRunRepository;
  readonly onboarding:    IOnboardingRepository;
  readonly projectConfig: IProjectConfigRepository;

  backup(options: BackupOptions): Promise<BackupResult>;
  healthCheck(): Promise<HealthStatus>;
  close(): Promise<void>;
}

export async function openRepository(config: RepositoryConfig): Promise<IFoundryRepository>;
export async function restoreRepository(
  backupPath: string,
  targetDir: string,
  encryptionKey: string,
): Promise<IFoundryRepository>;
```

### 5.3 Sub-Repository Interfaces

> All store methods are **synchronous** (better-sqlite3 sync API). Only operations involving subprocesses or filesystem I/O are async.

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

**Tasks (immutable)**

```typescript
interface ITaskRepository {
  create(task: NewTask): Task;
  // Immutable after creation. No update method exists.
  // NewTask: { projectId, agent, description, createdBy, inputs, outputs }
  // inputs:  [{ name, artifact_id }]
  // outputs: [{ name, type, isFailure?: boolean }]
  //   isFailure: true marks this output as the failure signal for state derivation.

  get(id: string): Task | null;

  findRoutable(projectId: string): Task[];
  // Returns tasks where:
  //   all input artifact_ids exist in the artifacts table
  //   claimed_at IS NULL
  //   no output artifacts exist yet (neither success nor failure)

  claim(taskId: string): void;
  // Writes claimed_at. Called by loop before opening agent session.

  recoverStalledTasks(): number;
  // On startup: clears claimed_at for tasks where no output artifact exists.
  // Returns count recovered.

  listForProject(projectId: string, filter?: TaskFilter): Task[];
  // filter: { agent?, state?: 'pending' | 'running' | 'complete' | 'failed' }
}
```

Task state derivation (performed in `tasks.ts`, never stored):

|Condition                                              |Derived State|
|-------------------------------------------------------|-------------|
|`claimed_at IS NULL`, no output artifacts              |`pending`    |
|`claimed_at IS NOT NULL`, no output artifacts          |`running`    |
|Any `isFailure: true` output artifact exists           |`failed`     |
|All non-failure output artifacts exist                 |`complete`   |

**Artifacts**

```typescript
interface IArtifactRepository {
  store(item: NewArtifact): Artifact;
  // NewArtifact: { projectId, taskId, outputName, type, name, content, metadata? }
  // taskId + outputName link artifact to the task output it satisfies.
  // Idempotent: if (taskId, outputName) already exists, returns existing artifact.
  // Routing (inline vs blob store) is internal based on size threshold.

  get(artifactId: string): ArtifactWithContent;
  getByTaskOutput(taskId: string, outputName: string): Artifact | null;
  list(projectId: string, filter?: ArtifactFilter): Artifact[];

  snapshotCode(projectId: string, taskId: string, repoPath: string, trigger?: string): Promise<Artifact>;
  restoreCode(artifactId: string, targetPath: string): Promise<void>;
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
  setStatus(id: string, status: CapabilityStatus, detail?: string): void;

  execute(
    projectCapabilityId: string,
    actionName: string,
    params: Record<string, string>,
    triggeredBy: 'agent' | 'founder-test',
  ): Promise<ExecutionResult>;

  getExecutionHistory(projectCapabilityId: string, limit?: number): CapabilityExecution[];
  captureAccountState(projectCapabilityId: string, trigger: AccountState['trigger']): Promise<void>;
  getLatestAccountState(projectCapabilityId: string): AccountState | null;
}
```

**Project Config**

```typescript
interface IProjectConfigRepository {
  get(projectId: string): ProjectConfig | null;
  set(projectId: string, config: ProjectConfig, createdBy: string): ProjectConfig;
  validateDag(config: ProjectConfig): DagValidationResult;
  listVersions(projectId: string): ProjectConfig[];
}
```

**Activity**

```typescript
interface IActivityRepository {
  append(event: NewActivityEvent): ActivityEvent;
  list(projectId: string, filter?: ActivityFilter): ActivityEvent[];
}

// Event types:
// loop-run-started | loop-run-complete | loop-run-failed
// task-claimed | task-complete | task-failed
// artifact-written | capability-executed
// founder-task-surfaced | founder-task-completed
// project-config-set | recovery-triggered
```

**Loop Runs**

```typescript
interface ILoopRunRepository {
  start(projectId: string): LoopRun;
  complete(runId: string, summary: LoopRunSummary): void;
  fail(runId: string, error: string): void;
  getCurrent(projectId: string): LoopRun | null;
  getLastCompleted(projectId: string): LoopRun | null;
  recoverStalledRuns(): number;
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

### 5.4 Backup and Restore

```typescript
interface BackupOptions {
  path: string;
  compress?: boolean;
  includeBlobs?: boolean;
  verify?: boolean;
}

interface BackupResult {
  path: string;
  sizeBytes: number;
  durationMs: number;
  checksum: string;
  includes: { database: true; blobs: boolean; blobCount: number };
}
```

`backup()` uses SQLite's online backup API. `restoreRepository()` is a static function. The encryption key is not included in the backup — it must be provided at restore time.

-----

## 6. Data Model

All tables are defined in `src/repository/impl/schema/index.ts` using Drizzle ORM.

### 6.1 Overview

```
projects          ← project briefs and status
project_configs   ← agent definitions, head/tail, workspace (append-only versions)
tasks             ← immutable work units with declared inputs/outputs
artifacts         ← all produced content, linked to tasks
activity_log      ← append-only event stream
loop_runs         ← loop session tracking

capabilities            ← reusable integration templates
capability_actions      ← scripts/configs per capability
project_capabilities    ← per-project configured instances
capability_executions   ← append-only action execution log
account_snapshots       ← point-in-time external service state

onboarding_sessions
onboarding_messages
```

### 6.2 Schema

```sql
-- ── Core ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'active',
  brief      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Append-only. Latest by created_at is active config.
CREATE TABLE IF NOT EXISTS project_configs (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  config     TEXT NOT NULL,   -- JSON: ProjectConfig — see Section 9
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL    -- 'founder' | 'system'
);

-- IMMUTABLE. No UPDATE. No DELETE.
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  agent       TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  -- task_id of creating agent's task, or 'system' for bootstrap tasks
  claimed_at  TEXT,

  inputs  TEXT NOT NULL DEFAULT '[]',
  -- JSON: [{ name: string, artifact_id: string }]

  outputs TEXT NOT NULL DEFAULT '[]'
  -- JSON: [{ name: string, type: string, isFailure?: boolean }]
  -- isFailure: true → writing this output marks the task failed, not complete
);

CREATE TABLE IF NOT EXISTS artifacts (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  task_id      TEXT REFERENCES tasks(id),
  output_name  TEXT,
  -- UNIQUE(task_id, output_name) — enforced below; write_artifact is idempotent

  type         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,

  content          TEXT,
  content_encoding TEXT,
  blob_hash        TEXT,
  content_size     INTEGER NOT NULL,
  content_hash     TEXT NOT NULL,

  metadata     TEXT,
  snapshot_of  TEXT,
  supersedes   TEXT REFERENCES artifacts(id),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,

  CHECK ((content IS NOT NULL) != (blob_hash IS NOT NULL)),
  UNIQUE(task_id, output_name)
  -- Duplicate writes for the same (task_id, output_name) are ignored (idempotent).
  -- Use INSERT OR IGNORE in the store implementation.
);

-- APPEND ONLY.
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  timestamp  TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_runs (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'running',
  tasks_dispatched INTEGER DEFAULT 0,
  summary          TEXT,
  error            TEXT
);

-- ── Capabilities ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capabilities (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  setup_guide  TEXT NOT NULL,
  config_schema TEXT NOT NULL,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_actions (
  id              TEXT PRIMARY KEY,
  capability_id   TEXT NOT NULL REFERENCES capabilities(id),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  script          TEXT NOT NULL,
  param_schema    TEXT,
  is_destructive  INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 0,
  UNIQUE(capability_id, name)
);

CREATE TABLE IF NOT EXISTS project_capabilities (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  capability_id    TEXT NOT NULL REFERENCES capabilities(id),
  credentials_enc  TEXT,
  credentials_iv   TEXT,
  credentials_tag  TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  last_tested_at   TEXT,
  last_test_status TEXT,
  last_test_output TEXT,
  configured_at    TEXT,
  notes            TEXT,
  UNIQUE(project_id, capability_id)
);

-- APPEND ONLY.
CREATE TABLE IF NOT EXISTS capability_executions (
  id                    TEXT PRIMARY KEY,
  project_capability_id TEXT NOT NULL REFERENCES project_capabilities(id),
  action_id             TEXT NOT NULL REFERENCES capability_actions(id),
  params                TEXT,
  triggered_by          TEXT NOT NULL,
  executed_at           TEXT NOT NULL,
  status                TEXT NOT NULL,
  output                TEXT,
  error                 TEXT,
  duration_ms           INTEGER
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id                      TEXT PRIMARY KEY,
  project_capability_id   TEXT NOT NULL REFERENCES project_capabilities(id),
  captured_at             TEXT NOT NULL,
  trigger                 TEXT NOT NULL,
  state                   TEXT NOT NULL,
  raw_response            TEXT,
  triggered_by_execution  TEXT REFERENCES capability_executions(id)
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
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  timestamp  TEXT NOT NULL
);

-- ── Indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON tasks(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_agent
  ON tasks(project_id, agent);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed
  ON tasks(claimed_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_project
  ON artifacts(project_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_task
  ON artifacts(task_id, output_name);
CREATE INDEX IF NOT EXISTS idx_artifacts_hash
  ON artifacts(content_hash);
CREATE INDEX IF NOT EXISTS idx_activity_project
  ON activity_log(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_loop_runs_project
  ON loop_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_configs_project
  ON project_configs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_project
  ON project_capabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_pc
  ON capability_executions(project_capability_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_pc
  ON account_snapshots(project_capability_id, captured_at DESC);
```

-----

## 7. Loop

### 7.1 Responsibility

The loop is responsible for exactly three things:

1. **Scheduling** — when to tick, how often, max parallel projects
1. **Routing** — find routable tasks, dispatch to agent or surface to founder
1. **Observability** — record that a tick happened, what ran, system health

### 7.2 Scheduler

```typescript
// src/loop/scheduler.ts

class Scheduler {
  constructor(private config: SchedulerConfig, private repo: IFoundryRepository) {}

  start() {
    this.repo.loopRuns.recoverStalledRuns();
    this.repo.tasks.recoverStalledTasks();
    setInterval(() => this.tick(), this.config.intervalMs);
  }

  async runNow(projectId: string): Promise<void> {
    const project = this.repo.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    await this.runProject(project);
  }

  private async tick() {
    const active = this.repo.projects.list('active');
    await Promise.all(
      active
        .slice(0, this.config.maxParallel)
        .map(p => this.runProject(p).catch(err => console.error(...)))
    );
  }

  private async runProject(project: Project) {
    const run = this.repo.loopRuns.start(project.id);
    try {
      const routable = this.repo.tasks.findRoutable(project.id);
      let dispatched = 0;
      for (const task of routable) {
        await dispatch(task, project, this.repo);
        dispatched++;
      }
      this.repo.loopRuns.complete(run.id, { tasksDispatched: dispatched });
    } catch (err) {
      this.repo.loopRuns.fail(run.id, String(err));
    }
  }
}
```

### 7.3 Router

```typescript
// src/loop/router.ts

export async function dispatch(task: Task, project: Project, repo: IFoundryRepository) {
  const config = repo.projectConfig.get(project.id);
  if (!config) throw new Error(`No config for project: ${project.id}`);

  repo.tasks.claim(task.id);
  repo.activity.append({ projectId: project.id, event: 'task-claimed', detail: { taskId: task.id, agent: task.agent } });

  if (task.agent === 'founder') {
    repo.activity.append({ projectId: project.id, event: 'founder-task-surfaced', detail: { taskId: task.id } });
    return;
  }

  const agentDef = config.agents.find(a => a.name === task.agent);
  if (!agentDef) throw new Error(`Unknown agent: ${task.agent}`);

  const context = buildAgentContext(task, agentDef, config, repo);
  await runAgentSession(context, repo);

  repo.activity.append({ projectId: project.id, event: 'task-complete', detail: { taskId: task.id } });
}
```

### 7.4 Crash Recovery

On startup, `recoverStalledRuns()` and `recoverStalledTasks()` run before the first tick:

- Loop runs with `status = 'running'` → marked `failed`
- Tasks with `claimed_at IS NOT NULL` and no output artifacts → `claimed_at` cleared

Both return a count. The scheduler logs the counts on startup.

-----

## 8. Agent System

### 8.1 Mental Model

An agent is a Claude Agent SDK session scoped to a single task. It receives input artifacts as context, has access to its declared tools, and produces output artifacts. When it is done, the session ends. It has no memory of prior sessions.

Agents are not hardcoded. They are defined entirely in the project config. The agent runtime is generic.

### 8.2 Agent Runtime

```typescript
// src/agents/runtime.ts

export async function runAgentSession(context: AgentContext, repo: IFoundryRepository) {
  const toolServer = buildToolServer(context, repo);

  const q = query({
    prompt: buildInitialPrompt(context),
    options: {
      systemPrompt: context.systemPrompt,
      mcpServers: { foundry: toolServer.mcpConfig },
      tools: [],                             // built-in SDK tools disabled
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 50,
      persistSession: false,
    },
  });

  for await (const message of q) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(`Agent error: ${message.subtype}`);
      break;
    }
  }
}
```

### 8.3 Agent Context Construction

```typescript
// src/agents/context.ts

export function buildAgentContext(
  task: Task,
  agentDef: AgentDefinition,
  config: ProjectConfig,
  repo: IFoundryRepository,
): AgentContext {
  const inputArtifacts = task.inputs.map(i => ({
    name: i.name,
    artifact: repo.artifacts.get(i.artifact_id),
  }));

  const colleagues = config.agents
    .filter(a => a.name !== agentDef.name)
    .map(a => `- ${a.name}: consumes [${a.consumes.join(', ')}], produces [${a.produces.join(', ')}]`)
    .join('\n');

  const systemPrompt = `${agentDef.prompt}

## Your colleagues
${colleagues}

## Your declared outputs
Before this session ends, you must produce artifacts for each of these:
${task.outputs.filter(o => !o.isFailure).map(o => `- ${o.name} (type: ${o.type})`).join('\n')}

If you cannot complete the task, produce the failure output instead:
${task.outputs.filter(o => o.isFailure).map(o => `- ${o.name} (type: ${o.type})`).join('\n') || '(none declared)'}

When producing a failure output, also call create_task to dispatch a recovery agent.
Use write_artifact for each output. write_artifact returns { artifact_id } — use this when calling create_task.

## Workspace
${config.workspace}

## Project
Head: ${JSON.stringify(config.head)}
Goal: ${JSON.stringify(config.tail)}`;

  return { taskId: task.id, projectId: task.project_id, systemPrompt, inputArtifacts, agentDef, config };
}

export function buildInitialPrompt(context: AgentContext): string {
  // Artifact_ids are surfaced so agents can reference them in create_task inputs.
  const artifactSummaries = context.inputArtifacts
    .map(({ name, artifact }) =>
      `## ${name} (${artifact.type})\nartifact_id: ${artifact.id}\n\n${
        artifact.content ?? '[large artifact — call read_artifact to retrieve full content]'
      }`
    )
    .join('\n\n');

  return `Your task: ${context.taskId}

## Input artifacts
${artifactSummaries}

Begin.`;
}
```

### 8.4 System Tools

Available to any agent that declares them in `tools[]`.

```typescript
// src/agents/tools/system.ts

read_artifact({ artifact_id: string })
// Returns: { type, name, content, metadata }

write_artifact({
  name: string,     // must match a name in task.outputs[]
  type: string,     // must match the declared type for that output
  content: string,
  metadata?: object
})
// Writes artifact linked to current task + output name.
// Validates: name in task.outputs[], type matches declaration.
// Idempotent: if artifact already exists for (task_id, output_name), returns existing.
// Returns: { artifact_id }

create_task({
  agent: string,
  description: string,
  inputs: Array<{ name: string; artifact_id: string }>,
  outputs: Array<{ name: string; type: string; isFailure?: boolean }>,
})
// Creates a new task. Runs DAG validation — rejects if connectivity breaks.
// Returns: { task_id } on success, { error } on validation failure.
```

### 8.5 Compute Tools

Available to any agent that declares them in `tools[]`. All operations are scoped to the project `workspace` path — paths are resolved relative to it and validated to prevent escape.

```typescript
// src/agents/tools/compute.ts

run_command({ command: string, cwd?: string })
// Executes shell command. cwd is relative to workspace (default: workspace root).
// Returns: { stdout, stderr, exit_code, duration_ms }
// Timeout: 5 minutes.

read_file({ path: string })
// Reads file at workspace-relative path.
// Returns: { content, size_bytes }

write_file({ path: string, content: string })
// Writes file at workspace-relative path. Creates intermediate directories.
// Returns: { path, size_bytes }
```

Compute tools are not capability actions — they are system-level tools like `read_artifact`. They are declared in `tools[]` by the same name (`"run_command"`, `"read_file"`, `"write_file"`).

### 8.6 Project Tools

Capability actions configured for this project. An agent declares them by action name in `tools[]`. The runtime resolves each against project capabilities and builds a corresponding MCP tool. The agent never sees credential values.

### 8.7 Tool Surface

An agent's full tool surface = declared system tools + declared compute tools + declared project tools. All from `agentDef.tools[]`. The tool server contains exactly these — no others registered.

### 8.8 Founder Agent

`founder` is the one system-level agent concept. When the loop encounters `agent: 'founder'`, no session is opened. The task surfaces in the UI's Founder Queue. The founder submits a result via `POST /api/tasks/:id/complete`, which writes the output artifact. Downstream tasks become routable on the next tick.

### 8.9 Agent Specialization Over Time

The initial agent set is intentionally broad. Over time, as the project config gains more specialized agents, existing agents naturally delegate more — because the config tells them their colleagues exist. The loop, task schema, and artifact system never change. Intelligence grows by addition.

-----

## 9. Project Config

### 9.1 Purpose

The project config is the single source of truth for everything project-specific about how Foundry behaves. Given a project config and a head artifact, a fresh Foundry instance can resume execution.

### 9.2 Schema

```typescript
interface ProjectConfig {
  workspace: string;
  // Absolute path to the project's working directory on this machine.
  // All compute tool operations (run_command, read_file, write_file) are scoped here.

  head: Array<{
    name: string;
    type: string;
    artifact_id: string;
  }>;

  tail: Array<{
    name: string;
    type: string;
  }>;

  agents: AgentDefinition[];
}

interface AgentDefinition {
  name: string;
  // Unique within project. Special reserved value: 'founder'

  consumes: string[];
  // Artifact types this agent accepts as task inputs (used by DAG validator).

  produces: string[];
  // Artifact types this agent produces as task outputs.
  // write_artifact validates against task.outputs[] at runtime.

  tools: string[];
  // Explicit full list of tools available to this agent.
  // System tools:  'read_artifact' | 'write_artifact' | 'create_task'
  // Compute tools: 'run_command' | 'read_file' | 'write_file'
  // Project tools: any capability action name configured for this project.
  // No implicit grants.

  prompt: string | null;
  // Null only for 'founder'.
}
```

### 9.3 Example Config — Snapquery

```json
{
  "workspace": "/home/terry/projects/snapquery",

  "head": [
    { "name": "brief", "type": "brief", "artifact_id": "art_001" }
  ],

  "tail": [
    { "name": "deployed_app",        "type": "environment" },
    { "name": "launch_announcement", "type": "content"     }
  ],

  "agents": [
    {
      "name": "strategist",
      "consumes": ["brief", "decision"],
      "produces": ["decision", "task_graph"],
      "tools": ["read_artifact", "write_artifact", "create_task"],
      "prompt": "You are the strategist for Snapquery. Your job is to read the project brief and any existing decisions, identify what is missing or unresolved, and produce decision artifacts and task graphs. You create tasks for your colleagues — you do not implement anything yourself. Always produce a task_graph artifact documenting what you've planned and why. When creating tasks, be explicit about inputs and outputs."
    },
    {
      "name": "coder",
      "consumes": ["brief", "decision", "repository", "code"],
      "produces": ["code", "repository", "dependency_failure"],
      "tools": ["read_artifact", "write_artifact", "create_task", "run_command", "read_file", "write_file"],
      "prompt": "You are the coder for Snapquery. You implement features, scaffold projects, and push code. You have access to the project workspace. If you discover a missing dependency mid-execution that you cannot resolve, produce a dependency_failure artifact (isFailure: true) and immediately create a task for the planner agent with that failure artifact as input. Do not produce your declared code output if the dependency is unresolvable."
    },
    {
      "name": "deployer",
      "consumes": ["code", "repository", "environment_config"],
      "produces": ["environment", "dependency_failure"],
      "tools": ["read_artifact", "write_artifact", "create_task", "fly_deploy", "fly_set_secret"],
      "prompt": "You are the deployer for Snapquery. You deploy code to environments. Capture the resulting state as your environment output: live URL, deployment ID, relevant configuration. If deployment fails and cannot be retried, produce a dependency_failure artifact (isFailure: true) and create a task for the planner with that artifact as input."
    },
    {
      "name": "marketer",
      "consumes": ["brief", "content", "environment"],
      "produces": ["content"],
      "tools": ["read_artifact", "write_artifact"],
      "prompt": "You are the marketer for Snapquery. You write launch copy, announcements, and social posts. Produce polished, specific content ready to use without further editing."
    },
    {
      "name": "planner",
      "consumes": ["dependency_failure", "task_graph"],
      "produces": ["task_graph"],
      "tools": ["read_artifact", "write_artifact", "create_task"],
      "prompt": "You are the planner for Snapquery. You respond to failure artifacts and broken task graphs. Read the failure artifact carefully. Determine the minimum set of new tasks required to recover. Create those tasks with correct agent assignments, inputs, and outputs. Produce a task_graph artifact documenting the recovery plan and rationale."
    },
    {
      "name": "founder",
      "consumes": ["*"],
      "produces": ["*"],
      "tools": [],
      "prompt": null
    }
  ]
}
```

### 9.4 DAG Validation

Runs at project creation and at `create_task` time. Operates on artifact types (not instances). Checks: given this workforce, is it structurally possible to get from head types to tail types?

```typescript
function validateDag(config: ProjectConfig): DagValidationResult {
  // Build reachable type set from head artifact types.
  // Walk forward through agent signatures (consumes → produces).
  // Check all tail types are reachable.
  return { valid, unreachableTail, orphanedAgents, missingProducers };
}
```

If validation fails at project creation, the project is not saved. If it fails at `create_task`, the tool returns `{ error }` and the task is not written.

### 9.5 Config Versioning

Append-only. Each `set()` creates a new row. Latest by `created_at` is active. The loop resolves agent definitions from the active config at dispatch time.

-----

## 10. Artifact System

### 10.1 Role

Artifacts are the only coordination mechanism between agents. Every artifact is typed, linked to the task that produced it, immutable after creation, and content-addressed.

### 10.2 Artifact Types

Fully project-defined strings. The system enforces:
- `write_artifact` validates type matches the declared type for that output name
- DAG validation checks type-level connectivity across agent signatures

### 10.3 Storage Strategy

- **Inline** (< threshold, default 50MB): gzip+base64 in `content` column
- **Blob store** (`foundry.blobs/`): files named by SHA-256 content hash

### 10.4 Task Linkage

Every artifact is linked via `task_id + output_name`. The `UNIQUE(task_id, output_name)` constraint means each task output is written exactly once. Duplicate writes are idempotent (INSERT OR IGNORE).

### 10.5 Code Snapshots

`artifacts.snapshotCode()` creates a git bundle, compresses it, and routes to inline or blob store. Bundle can be cloned: `git clone /path/to/snap.bundle ./recovered-repo`.

-----

## 11. Capability System

### 11.1 Mental Model

A capability is a reusable integration template. A project capability is an instance for a specific project with encrypted credentials. In v1.2, capabilities are project tools — declared by action name in `tools[]`, resolved and executed by the agent runtime.

### 11.2 Action Types

**HTTP** — structured JSON config with `{{CRED_*}}` and `{{PARAM_*}}` interpolation.

**Bash** — script executed via `child_process.spawn`. Credentials as `CRED_*` env vars, params as `PARAM_*` env vars. No shell interpolation of values.

**Playwright** — script via `npx playwright run`. Last resort for browser-only actions.

### 11.3 Credential Security

AES-256-GCM. `saveCredentials()` encrypts and stores. `execute()` decrypts in memory, injects as env vars, wipes after subprocess. No API route or agent tool returns decrypted values.

### 11.4 Built-in Capability Library

|Capability  |Category      |Key Actions                                     |
|------------|--------------|------------------------------------------------|
|GitHub      |infrastructure|create-repo, push-branch, create-pr, create-issue|
|Fly.io      |deployment    |deploy, set-secret, scale                       |
|Vercel      |deployment    |deploy, set-env                                 |
|Railway     |deployment    |deploy, set-env                                 |
|Twitter/X   |marketing     |post, reply                                     |
|Linear      |infrastructure|create-issue, update-status                     |
|Slack       |communication |post-message                                    |
|Email (SMTP)|communication |send                                            |
|npm         |infrastructure|publish                                         |
|Stripe      |payments      |create-product, create-price, create-checkout   |
|AWS S3      |infrastructure|upload, make-public                             |

-----

## 12. API

### 12.1 Design

Thin. Validates input, calls repository, returns data. No domain logic. All routes under `/api`. Express also serves the static React build from `ui/dist`.

### 12.2 Routes

**Projects**

```
GET  /api/projects
GET  /api/projects/:id
POST /api/projects          ← via onboarding only
```

**Project Config**

```
GET  /api/projects/:id/config
PUT  /api/projects/:id/config         ← DAG validation; 400 if invalid
GET  /api/projects/:id/config/history
```

**Tasks**

```
GET  /api/tasks?projectId=&agent=&state=
GET  /api/tasks/:id
POST /api/tasks/:id/complete          ← founder only: writes result artifact
     body: { outputName, content, type, metadata? }
```

**Artifacts**

```
GET  /api/artifacts?projectId=&type=&taskId=
GET  /api/artifacts/:id
GET  /api/artifacts/:id/content
```

**Activity**

```
GET  /api/activity?projectId=&since=&limit=
```

**Capabilities**

```
GET  /api/capabilities
POST /api/capabilities
GET  /api/capabilities/:id
PUT  /api/capabilities/:id

GET  /api/projects/:id/capabilities
POST /api/projects/:id/capabilities
POST /api/projects/:id/capabilities/:pcId/configure
GET  /api/projects/:id/capabilities/:pcId/executions
```

**Onboarding**

```
POST /api/onboarding/sessions
GET  /api/onboarding/sessions/:id
POST /api/onboarding/sessions/:id/message
POST /api/onboarding/approve
```

**Admin**

```
POST /api/admin/run/:projectId
GET  /api/admin/runs/:projectId
POST /api/admin/backup
GET  /api/admin/dag/:projectId
```

**Health**

```
GET  /api/health
```

-----

## 13. Onboarding

### 13.1 Flow

New projects are created through a chat interface. The onboarding agent asks questions, generates a project brief, and suggests an initial agent config. The founder reviews and edits before approving.

```
/ → [+ New Project] → /new → session created → /new/:sessionId
  → conversation
  → agent outputs <brief> XML + <config> JSON
  → UI renders brief preview + editable agent config
  → DAG validation runs client-side on config edits
  → Approve → POST /api/onboarding/approve
    → creates project record
    → writes brief as head artifact (type: 'brief')
    → stores initial project config (including workspace)
    → runs DAG validation — 400 if invalid
    → creates bootstrap task:
        { agent: 'strategist', inputs: [{ name: 'brief', artifact_id }],
          outputs: [{ name: 'task_graph', type: 'task_graph' }] }
  → redirect to /[projectId]/dag
```

### 13.2 Session Persistence

Each message request reconstructs full conversation history from DB, sends to Claude with `maxTurns: 1`. Session ID in URL — closing and reopening resumes conversation.

### 13.3 Onboarding Agent Output

```xml
<brief>
  <n>Snapquery</n>
  <tagline>Fast, drag-and-drop data exploration with SQL for anyone</tagline>
  <problem>...</problem>
  <user>...</user>
  <mvp>...</mvp>
  <constraints>...</constraints>
  <existing>...</existing>
  <assumptions>
    <assumption>...</assumption>
  </assumptions>
</brief>
```

```json
<config>
{
  "workspace": "/home/terry/projects/snapquery",
  "agents": [...],
  "tail": [...]
}
</config>
```

-----

## 14. Admin API

```
POST /api/admin/run/:projectId    ← fire-and-forget; 409 if already running
GET  /api/admin/runs/:projectId   ← { current, last }
POST /api/admin/backup            ← { path?, compress? } → BackupResult
GET  /api/admin/dag/:projectId    ← DagValidationResult
```

-----

## 15. Security

### 15.1 Threat Model

Home server, private network. Primary threats: data loss (mitigated by backups), credential exposure (AES-256-GCM), accidental destructive actions (`requires_approval` flag).

### 15.2 Credential Encryption

AES-256-GCM. Key in `FOUNDRY_ENCRYPTION_KEY` env var only. Tampered ciphertext fails to decrypt (auth tag). Key loss = credentials unrecoverable, rest of DB unaffected.

### 15.3 Agent Tool Sandboxing

Tool surface is structural, not prompt-based. The MCP server for each session contains exactly the declared tools — no others registered. Compute tools are workspace-scoped: paths resolved relative to `config.workspace`, validated to prevent directory traversal.

### 15.4 Script Injection

Bash actions use env vars for params, not shell interpolation. `child_process.spawn(cmd, args, { env: { ... } })` — the shell never sees param values directly.

-----

## 16. Operational

### 16.1 Deployment

```
Home server
├── Nginx (port 80/443) → localhost:3001
└── Node.js / PM2 (port 3001)
    ├── Express API + static UI
    ├── Loop scheduler
    └── SQLite + blob store
```

### 16.2 Configuration

```bash
# Required
FOUNDRY_ENCRYPTION_KEY=<64-char hex>

# Paths
DB_PATH=./foundry.db
BLOB_DIR=./foundry.blobs
BLOB_THRESHOLD_MB=50

# Server
PORT=3001

# Loop
LOOP_INTERVAL_MINUTES=10
MAX_PARALLEL_PROJECTS=1
```

### 16.3 PM2

```javascript
module.exports = {
  apps: [{
    name: 'foundry',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env_file: '.env',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }],
};
```

### 16.4 Backup

Nightly cron at 3am. 14-day retention. `POST /api/admin/backup` for manual. Encryption key not included in backup — provided at restore time.

### 16.5 Health Check

```json
{
  "status": "ok",
  "db": { "ok": true, "sizeBytes": 4200000, "integrityOk": true },
  "blobs": { "ok": true, "count": 14, "totalBytes": 180000000 },
  "encryption": { "ok": true },
  "loop": { "lastRunAt": "...", "lastRunStatus": "complete", "tasksDispatched": 3 },
  "projects": [{ "id": "snapquery", "pendingTasks": 2, "runningTasks": 1, "founderTasks": 0 }]
}
```

-----

## 17. Build Phases

### Phases 1–6 — Complete

Repository, engine, API, UI, onboarding, deployment. See git history.

### Phase 7 — Task and Artifact Primitives

**Done when:**

- `tasks` and `project_configs` tables added with migrations
- `artifacts` table updated: `task_id`, `output_name`, `UNIQUE(task_id, output_name)` constraint
- `ITaskRepository` implemented: `create`, `findRoutable`, `claim`, `recoverStalledTasks`, `listForProject`
- `IProjectConfigRepository` implemented: `get`, `set`, `validateDag`, `listVersions`
- `IArtifactRepository` updated: `store` accepts `taskId` + `outputName`, idempotent on duplicate, `getByTaskOutput` works
- Task state derivation correct for all four states including `isFailure` flag
- Unit tests: routable task query, all state derivation cases, DAG validation (valid graph, disconnected tail, orphaned agent, missing producer)

### Phase 8 — Loop Rewrite

**Done when:**

- `src/engine/` removed. `src/loop/scheduler.ts` and `src/loop/router.ts` in place.
- Scheduler ticks, finds routable tasks, calls `dispatch`
- `dispatch` correctly handles `founder` (no session) vs agent tasks (session opened)
- `recoverStalledRuns` and `recoverStalledTasks` both run on startup
- Activity log entries written for: task-claimed, task-complete, loop-run-started, loop-run-complete

### Phase 9 — Agent Runtime and System Tools

**Done when:**

- `src/agents/runtime.ts`: session opens, iterates `query()`, handles result
- `src/agents/context.ts`: system prompt includes colleagues, declared outputs, isFailure instructions, workspace path; input prompt surfaces artifact_ids
- `src/agents/tools/system.ts`: `read_artifact`, `write_artifact`, `create_task` implemented
  - `write_artifact`: validates type, idempotent, returns `{ artifact_id }`
  - `create_task`: runs DAG validation, rejects on failure
- `src/agents/tools/compute.ts`: `run_command`, `read_file`, `write_file` — workspace-scoped, path traversal prevented
- `src/agents/tools/project.ts`: capability actions resolved by name → MCP tools
- `POST /api/tasks/:id/complete` writes founder output artifact correctly
- End-to-end: bootstrap task → strategist session → `write_artifact` (task_graph) + `create_task` (coder task) → coder task routable → loop routes → coder produces code artifact

### Phase 10 — Project Config and Onboarding Update

**Done when:**

- Onboarding outputs `<config>` JSON (with `workspace`) alongside `<brief>` XML
- UI renders editable agent config form with client-side DAG validation
- `POST /api/onboarding/approve` creates project + head artifact + project config + bootstrap task
- Config versioning: append-only, latest used by loop, history accessible
- `GET /api/projects/:id/config/history` works
- `GET /api/admin/dag/:projectId` returns current validation result

### Phase 11 — UI Updates

**Done when:**

- DAG View: task graph (nodes colored by agent, edges by artifact dep, head/tail highlighted, failed tasks red)
- Task Queue: derived states, agent filter
- Founder Queue: input content inline, result submission end-to-end
- Artifacts view: task linkage, inline content for text types
- Config view: agent editor with workspace field, client-side DAG validation
- Activity Feed: new event types
- Mobile-first, consistent design language

-----

## 18. Open Questions

**Config editing mid-project.** In-flight tasks were dispatched under the old config. Should the loop warn if the active task graph is incompatible with a new config version?

**Artifact content in agent context.** Large artifacts in the initial prompt may exceed context limits. Should the loop always pass only metadata and require agents to call `read_artifact` for content, or only above a size threshold?

**Onboarding config quality.** The suggested initial agent config depends on onboarding prompt quality. Should there be a library of starter configs for common project types?

**Parallel task execution.** Two tasks with no artifact dependency could run concurrently. Deferred to v1.3.

**Project tool approval flow.** Capability actions with `requires_approval: true` are currently blocked — an escalation is created. Should this integrate with the founder task system in v1.2 or remain as-is?

-----

## Appendix A: Document Maintenance

### A.1 When to Update

Update when a design decision changes architecture, schema, API, or described behavior. Do not update for implementation details that don't affect design.

### A.2 How to Update

**Changing a decision:** add note at top of affected section:
```
> ⚠️ Updated [date]: [description]. See [section X] for prior decision.
```

**Resolving an open question:** move from Section 18 to the relevant section with a decision header.

### A.3 Structure

Every section: what it is → public interface → internal design → tradeoffs. Tradeoffs are always explicit.

-----

## Appendix B: Conventions and Preferences

### B.1 Code Style

- Concise over verbose. No wrappers that only rename.
- Readable naming — reads like prose at the call site.
- No contrived abstraction. Earn every function and module.
- Default to simple. Complexity only when the problem demands it.
- TypeScript strict mode, `exactOptionalPropertyTypes: true`. No `any`. Conditional spread for optional fields.

### B.2 Architecture Preferences

- Repository boundary is hard. Enforced by ESLint.
- The loop is the only dispatcher.
- Agents are the only writers of domain artifacts.
- Tasks are immutable. `claim()` is a system operation, not a domain update.
- Everything explicit. Full tool surface declared in project config.
- Agents are project data. No code change to add/modify agent types.
- Single process unless the problem demands otherwise.

### B.3 UI Preferences

- Mobile-first. Primary device is a phone.
- Observation + override only. No domain logic in UI.
- Dark, dense, terminal-adjacent.
- Fonts: Syne (headings/labels), JetBrains Mono (metadata/ids/timestamps), Lora (body).
- Tailwind tokens: `surface-{0-4}`, `text-{primary,secondary,dim}`, `accent-{blue,green,amber,red,purple}`.
- `h-dvh` for full-height containers.

### B.4 Claude Agent SDK Constraints

- `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` both required for MCP tools.
- `query()` with `for await`. `persistSession: false`. `tools: []` to disable built-ins.
- In-process MCP via `createSdkMcpServer()` + `tool()`. Schemas in zod.
- `z.record(z.string(), z.string())` — two arguments in zod v4.

### B.5 Dependency Constraints

- Vite pinned to v5. Vite 6+ requires `node:util.styleText` unavailable in Node 18.
- Port 3001. Port 3000 conflicts on this machine.
- zod v4 installed.

### B.6 Operational Preferences

- Self-contained. Restorable from `foundry.db` + `foundry.blobs/` + `.env`.
- Home server. PM2 + Nginx + SQLite.
- Low ops burden.

### B.7 Design Philosophy

- The loop makes no decisions.
- Agents are responsible for their own failure handling. A coder that hits a blocker produces a failure artifact and dispatches recovery via `create_task` — it does not escalate to the loop.
- Project config is the source of truth.
- Type safety at the project level: agent signatures are the type system, DAG validation is the type checker.
- Specialization over scope creep. When an agent does too much, add a colleague.

-----

## Appendix C: Out of Scope for V1.2

**Operational hardening** — stall detection, retry limits, cycle detection. V1.3.

**Parallel task execution.** One active agent at a time.

**Sub-agent spawning within a session.** All coordination through the task system.

**Agent memory across sessions.** Agents are stateless per session.

**Starter config library.**

**Artifact summarization for context limits.**

**Blob store GC.**

**README.**

**"Backup now" UI button.**

**Founder task timeout and auto-resolution.**
