# FOUNDRY

**System Design • Version 1.3**

*Living document. Internal codename.*

-----

## 1. Overview

### 1.1 What It Is

Foundry is a locally-hosted autonomous project engine for a solo founder. It moves a software project forward without requiring continuous attention. Agents claim tickets, do work in sandboxed containers, and surface decisions to the founder only when genuinely blocked. The founder sets direction; agents execute.

### 1.2 The Core Problem

Solo founders lose ideas to analysis paralysis and execution stalls. Most decisions do not require deep founder input — they require a decision to have been made. Foundry removes the founder from the critical path for most decisions and most execution.

### 1.3 V1.3 Scope

- Fully decoupled microservice architecture — six independent services
- Ticket-driven agent execution from open ticket to committed code
- Git served over HTTP — agents clone and push without filesystem mounts
- Sandboxed agent execution via Podman — always, no exceptions
- Anthropic agent SDK for session management — tools are plain owned objects, no SDK dependency in tool logic
- Branching strategy is a project-level decision, not a system concern

### 1.4 What Changed from V1.2

V1.2 was over-engineered and fragile. V1.3 is a clean-room redesign.

|Removed                    |Reason                                                           |
|---------------------------|-----------------------------------------------------------------|
|Artifact store + blob store|Deliverables are files on disk in the git repo                   |
|Content hashing            |Git handles this                                                 |
|DAG validation             |Project-level concern, lives in AGENT.md                         |
|Capability system          |run_command + right image covers it                              |
|MCP server plumbing        |Anthropic agent SDK with owned tools is simpler and more portable|
|Project config versioning  |AGENT.md in git is the version history                           |
|Onboarding chat sessions   |Out of scope for V1.3                                            |
|Activity log service       |Observability infrastructure, deferred                           |
|Shared types package       |Each service defines its own types locally                       |
|Gateway service            |nginx handles routing                                            |

-----

## 2. Principles

These are constraints, not preferences. A proposed change that violates one requires explicit justification.

**The founder is never a bottleneck.** Agents run autonomously. When blocked, an agent creates a child ticket and suspends itself. The founder resolves it when ready. Nothing waits indefinitely.

**Services are decoupled by domain.** Six services: project, ticket, repo, sandbox, agent, web. Each owns its domain entirely. No shared databases, no shared code, no internal imports across service boundaries. The only contract between services is HTTP.

**Everything communicates through HTTP.** The scheduler, workers, and UI are all HTTP clients. No process accesses another service's database directly. No filesystem is shared except through the repo service.

**Sandboxing is always on.** Every agent session runs in a Podman container. `image` is required on every agent definition. There is no code path that runs agent commands outside a container. `--network=none` by default.

**AGENT.md is the coordination backbone.** Every agent reads AGENT.md from the repo at the start of every session. It contains stack, conventions, current state, secrets available, and the project's branching strategy. The system has no opinion about branching — AGENT.md does.

**Tools are portable and testable.** Agent tools are plain objects with a name, description, zod schema, and an execute function. They know nothing about the Anthropic SDK. The SDK manages the loop; tools are pure functions. Swapping the SDK or testing tools in isolation requires no agent session.

**Simple over clever.** The first working solution is usually correct enough. Complexity is introduced only when the problem demonstrably demands it. Each service should be understandable in a single reading.

-----

## 3. Architecture

### 3.1 Service Map

```
web  ← React static build
 │
nginx  ← SSL + routing
 ├── project
 ├── ticket
 ├── repo
 └── agent
      └── sandbox  ← agent calls sandbox (Podman containers)
```

nginx is the only public-facing entry point. Every service runs on an internal port. The agent service is the scheduler — it polls tickets and dispatches itself.

### 3.2 Communication Rules

- `web` → project, ticket, repo, agent (via nginx)
- `project` → ticket (to dispatch runs)
- `ticket` → nobody
- `repo` → nobody
- `agent` → ticket (claim/done/fail), sandbox (run_command), repo (clone URL only)
- `sandbox` → nobody

### 3.3 Ports

|Service|Port|Notes                                              |
|-------|----|---------------------------------------------------|
|nginx  |3000|Only public port. SSL termination + routing.       |
|project|3001|Internal only                                      |
|ticket |3002|Internal only                                      |
|repo   |3003|Internal only. Serves JSON and git wire protocol.  |
|sandbox|3004|Internal only                                      |
|agent  |3005|Internal only. Long-running + ephemeral sessions.  |
|web    |3006|Internal only. nginx serves static files from here.|

-----

## 4. Data Model

Each service owns its own database. No shared schema. No cross-service joins.

### 4.1 project service

```sql
projects
  id TEXT PRIMARY KEY
  name TEXT NOT NULL
  slug TEXT NOT NULL UNIQUE
  status TEXT NOT NULL DEFAULT 'active'  -- active | paused
  workspace TEXT NOT NULL                -- path to bare git repo
  schedule_interval INTEGER NOT NULL DEFAULT 600  -- seconds
  concurrency_limit INTEGER NOT NULL DEFAULT 3
  created_at TEXT NOT NULL
```

### 4.2 ticket service

```sql
tickets
  id TEXT PRIMARY KEY
  project_id TEXT NOT NULL
  title TEXT NOT NULL
  body TEXT NOT NULL           -- markdown
  agent TEXT NOT NULL          -- matches agent name in project config
  status TEXT NOT NULL DEFAULT 'open'
                               -- open | claimed | done | failed | blocked
  parent_id TEXT REFERENCES tickets(id)
  notes TEXT                   -- agent completion summary or founder response
  created_by TEXT NOT NULL     -- agent name | 'founder'
  created_at TEXT NOT NULL
  claimed_at TEXT              -- set on claim, used for stall detection
```

Ticket status transitions:

```
open → claimed     (POST /ticket/:id/claim — atomic)
claimed → done     (POST /ticket/:id/done)
claimed → failed   (POST /ticket/:id/fail)
claimed → blocked  (POST /ticket/:id/block — via create_ticket with block:true)
blocked → open     (automatic when child ticket is done)
failed → open      (POST /ticket/:id/reopen)
```

### 4.3 agent service

```sql
agent_definitions
  id TEXT PRIMARY KEY
  project_id TEXT NOT NULL
  name TEXT NOT NULL
  prompt TEXT NOT NULL
  image TEXT NOT NULL          -- required, no default
  env TEXT NOT NULL            -- JSON: string[] (secret names)
  created_at TEXT NOT NULL
  UNIQUE(project_id, name)

agent_sessions
  id TEXT PRIMARY KEY
  ticket_id TEXT NOT NULL
  agent_def_id TEXT NOT NULL REFERENCES agent_definitions(id)
  status TEXT NOT NULL DEFAULT 'running'  -- running | done | failed
  started_at TEXT NOT NULL
  ended_at TEXT
```

### 4.4 sandbox service

```sql
sandbox_runs
  id TEXT PRIMARY KEY
  session_id TEXT NOT NULL     -- agent session that spawned this
  image TEXT NOT NULL
  command TEXT NOT NULL
  status TEXT NOT NULL DEFAULT 'running'  -- running | done | failed
  exit_code INTEGER
  started_at TEXT NOT NULL
  ended_at TEXT
```

-----

## 5. API Reference

All routes prefixed by nginx per service. Bodies are JSON. Responses are JSON. Git wire protocol routes under `/repo/:slug.git/*` are not REST.

### 5.1 project

```
GET  /project           List projects. ?status=active|paused
POST /project           Create project
GET  /project/:id       Get project
PUT  /project/:id       Update project
POST /project/:id/run   Trigger immediate dispatch run
```

POST /project body:

```json
{
  "name": "string",
  "workspace": "string",        // absolute path to bare git repo
  "schedule_interval": 600,     // seconds
  "concurrency_limit": 3
}
```

### 5.2 ticket

```
GET  /ticket                List. ?projectId= &agent= &status= &parentId=
POST /ticket                Create ticket
GET  /ticket/:id            Get ticket
GET  /ticket/:id/chain      Full parent chain, root first
PUT  /ticket/:id            Update body or notes
POST /ticket/:id/claim      Atomic claim. 409 if already claimed.
POST /ticket/:id/done       Mark done. Unblocks parent if any.
POST /ticket/:id/fail       Mark failed.
POST /ticket/:id/reopen     Reopen failed ticket → open.
```

POST /ticket body:

```json
{
  "project_id": "string",
  "title": "string",
  "body": "string",             // markdown
  "agent": "string",            // must match an agent_definition name
  "parent_id": "string",        // optional
  "block": true                 // if true, suspends parent until this is done
}
```

GET /ticket/:id/chain response:

```json
[  // root first, current ticket last
  { "id": "...", "title": "...", "body": "...", "notes": "...", "agent": "...", "status": "..." }
]
```

### 5.3 repo

```
-- JSON file browser (UI) --
GET  /repo/:slug/file        List files. git ls-tree -r HEAD --name-only
GET  /repo/:slug/file/*      Read file. git show HEAD:{path}
POST /repo/:slug/file/*      Write file + commit. Founder only.

-- Git wire protocol (agents inside containers) --
GET  /repo/:slug.git/*       Fetch / clone
POST /repo/:slug.git/*       Push
```

Agent clone URL: `http://repo:3003/repo/{slug}.git`
Worker inside Podman: `http://host.containers.internal:3003/repo/{slug}.git`

### 5.4 sandbox

```
POST   /sandbox              Start a container run
GET    /sandbox/:id          Get run status + metadata
DELETE /sandbox/:id          Kill running container
GET    /sandbox/:id/output   Stream stdout/stderr (SSE)
```

POST /sandbox body:

```json
{
  "image": "node:20",
  "command": "string",
  "workspace": "string",        // absolute path, mounted at /work
  "env": {},                    // injected as container env vars
  "network": false              // default false (--network=none)
}
```

GET /sandbox/:id/output — SSE stream:

```
event: stdout  data: {"line": "..."}
event: stderr  data: {"line": "..."}
event: exit    data: {"code": 0}
```

### 5.5 agent

```
-- Definitions --
GET    /agent               List definitions. ?projectId=
POST   /agent               Create definition
GET    /agent/:id           Get definition
PUT    /agent/:id           Update definition
DELETE /agent/:id           Delete definition

-- Sessions --
POST   /agent/:id/session               Start session for a ticket
GET    /agent/:id/session/:sid          Get session status
DELETE /agent/:id/session/:sid          Kill session

-- Session messaging --
POST   /agent/:id/session/:sid/message  Send message to running session
GET    /agent/:id/session/:sid/message  List messages
GET    /agent/:id/session/:sid/status   idle | running | done | failed
```

-----

## 6. Agent System

### 6.1 Session Lifecycle

```
1. POST /agent/:id/session { ticket_id }
2. Agent service: POST /ticket/:id/claim  → 409 if race, abort
3. Agent service: GET /ticket/:id         → ticket
4. Agent service: GET /ticket/:id/chain   → parent chain
5. Agent service: GET /repo/:slug/file/AGENT.md → context doc
6. Build system prompt: agent prompt + AGENT.md + chain + ticket body
7. Open SDK session, enter tool loop
8. Session ends → POST /ticket/:id/done or /fail with notes
9. If blocked parent exists, ticket service unblocks it automatically
```

### 6.2 Tool Loop

The Anthropic agent SDK manages the loop. Tools are plain objects — name, description, zod schema, execute function — with no SDK imports. The SDK calls `execute`; tools call sandbox and ticket over HTTP. Portability and testability live in the tools, not the loop.

```typescript
interface Tool<P extends z.ZodTypeAny> {
  name: string
  description: string
  params: P
  execute: (params: z.infer<P>) => Promise<string>
}
```

### 6.3 Tools

|Tool           |Calls        |Description                                                                        |
|---------------|-------------|-----------------------------------------------------------------------------------|
|`run_command`  |POST /sandbox|Run shell command in Podman container. Returns stdout, stderr, exit_code.          |
|`create_ticket`|POST /ticket |Create child ticket. If `block:true`, suspends current ticket until child resolves.|

### 6.4 run_command

```typescript
run_command({
  command: string,  // shell command
  cwd?: string,     // relative to /work, default: /work
  network?: boolean // default false
})
// Returns: '{ stdout, stderr, exitCode }'
```

### 6.5 create_ticket

```typescript
create_ticket({
  title: string,
  body: string,     // markdown
  agent: string,
  block: boolean    // if true, suspends current ticket
})
// If block:true: parent status → 'blocked', resumes when child is done
// Returns: '{ ticket_id }'
```

-----

## 7. Sandbox

### 7.1 Design

Podman for all agent command execution. Always. No exceptions.

- Rootless Podman — no daemon, no root
- `--rm` on every container — auto-cleanup on exit
- `--network=none` by default — explicit opt-in per run
- Workspace mounted at `/work` read-write
- Secrets injected as env vars — agent never sees values
- 5 minute timeout per run, configurable

### 7.2 Container Invocation

```bash
podman run --rm \
  --network=none \
  -v {workspace}:/work \
  -w /work \
  -e SECRET_NAME=value \
  {image} \
  sh -c '{command}'
```

### 7.3 Image Policy

`image` is required on every agent definition. No default. Validation at agent creation — missing image is a hard error. Different agents in the same project can use different images.

```typescript
{ name: 'coder',    image: 'node:20' }
{ name: 'deployer', image: 'flyio/flyctl:latest' }
{ name: 'tester',   image: 'node:20' }
```

-----

## 8. Repository Service

### 8.1 Design

Serves two surfaces under the same path prefix: a JSON file browser for the UI, and the git smart HTTP protocol for agents inside containers.

### 8.2 Bare Repos

Each project has a bare git repo on disk. Workers clone, work in their container, and push back.

```bash
# Initialise a new project repo
git init --bare /home/terry/repos/snapquery.git

# Worker inside container
git clone http://repo:3003/repo/snapquery.git /work
# ... do work ...
git push origin ticket-001
```

### 8.3 AGENT.md

Every agent reads AGENT.md at session start via `GET /repo/:slug/file/AGENT.md`. The founder maintains this file. It must contain:

- **Stack:** language, frameworks, deployment target
- **Conventions:** file structure, naming, testing approach
- **Current state:** what works, what is in progress, what is blocked
- **Branching strategy:** how agents should use git
- **Secrets available:** names of env vars agents can use

The system has no opinion about branching. AGENT.md might say "branch per ticket, open PR", or "commit directly to main", or "do not touch git, just write files." The agent follows AGENT.md.

-----

## 9. Scheduling

### 9.1 Design

No separate scheduler service. A `setInterval` inside the project service fires on `schedule_interval` and dispatches open tickets.

### 9.2 Dispatch Loop

```typescript
// Every schedule_interval seconds:
const open    = await GET /ticket?projectId=X&status=open
const claimed = await GET /ticket?projectId=X&status=claimed

if (claimed.length >= project.concurrency_limit) return

const slots      = project.concurrency_limit - claimed.length
const toDispatch = open.slice(0, slots)

for (const ticket of toDispatch) {
  const agentDef = agents.find(a => a.name === ticket.agent)
  if (!agentDef) continue
  await POST /agent/:agentDefId/session { ticket_id: ticket.id }
}
```

### 9.3 Stall Recovery

On startup, tickets with `status=claimed` and `claimed_at` older than `schedule_interval * 3` are reset to `open`. A stalled ticket means the agent service crashed mid-session.

### 9.4 Manual Trigger

`POST /project/:id/run` triggers an immediate dispatch run. Used by the UI's "Run Now" button.

-----

## 10. Security

### 10.1 Threat Model

Home server, private network. Technical founder. Primary threats: accidental destructive agent commands, credential exposure, runaway containers.

### 10.2 Sandbox Isolation

- Podman rootless — containers run as the current user, never root
- `--network=none` by default
- 5 minute timeout — runaway processes are killed
- Workspace is the only mounted volume

### 10.3 Credential Management

- Secret values stored AES-256-GCM encrypted in the agent service database
- Key in `FOUNDRY_ENCRYPTION_KEY` env var only — never in the database
- Decrypted in memory at dispatch time, injected as container env vars
- No API route returns decrypted values

### 10.4 nginx

- Only public-facing port is 3000
- All service ports are internal
- SSL termination at nginx, Certbot for certificate management

-----

## 11. File Structure

```
foundry/
├── project/
├── ticket/
├── repo/
├── sandbox/
├── agent/
├── web/
├── nginx/
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
└── .env.example
```

Each service:

```
{service}/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── index.ts          ← Express entry point
    ├── db/
    │   ├── client.ts
    │   ├── schema.ts
    │   └── migrations/
    ├── routes/
    └── __tests__/
        ├── helpers/
        │   └── db.ts     ← in-memory test DB helper
        └── routes/
```

-----

## 12. Tech Stack

|Layer        |Choice                |Reason                                                                    |
|-------------|----------------------|--------------------------------------------------------------------------|
|Runtime      |Node 18+ / TypeScript |Long-running process, async-native, consistent across all services        |
|Web server   |Express               |Thin, well-understood, no magic                                           |
|Database     |SQLite via Drizzle ORM|Per-service embedded DB, zero ops, full SQL, type-safe schema             |
|Containers   |Podman (rootless)     |No daemon, no root, identical to Docker API, auto-cleanup                 |
|LLM          |Anthropic agent SDK   |SDK manages the loop; tools are plain owned objects with no SDK dependency|
|UI framework |React + Vite 5        |Static build served by nginx                                              |
|Styling      |Tailwind CSS v3       |Utility-first, no runtime overhead                                        |
|Git protocol |node-git-server       |Implements smart HTTP protocol in-process, no CGI                         |
|Testing      |vitest + supertest    |Fast, ESM-native, consistent across services                              |
|Deployment   |docker-compose        |Single-host, home server, simple to reason about                          |
|Reverse proxy|nginx                 |SSL termination, static files, service routing                            |

-----

## 13. Operational

### 13.1 Environment Variables

```bash
# Required
FOUNDRY_ENCRYPTION_KEY=<64-char hex>

# Ports
PROJECT_PORT=3001
TICKET_PORT=3002
REPO_PORT=3003
SANDBOX_PORT=3004
AGENT_PORT=3005

# Service URLs
TICKET_URL=http://ticket:3002
SANDBOX_URL=http://sandbox:3004
REPO_URL=http://repo:3003
AGENT_URL=http://agent:3005
```

### 13.2 docker-compose

```yaml
services:
  nginx:   { ports: ['3000:3000'] }
  project: { expose: ['3001'] }
  ticket:  { expose: ['3002'] }
  repo:    { expose: ['3003'] }
  sandbox: { expose: ['3004'] }
  agent:   { expose: ['3005'] }
  web:     { expose: ['3006'] }
```

### 13.3 Build Order

Get tests green at each phase before moving on.

1. ticket service — schema, all routes, tests
1. project service — schema, CRUD routes, tests
1. repo service — JSON file browser, git wire protocol
1. sandbox service — Podman integration, streaming output
1. agent service — definitions CRUD, session lifecycle, tool loop
1. project scheduler — dispatch loop, stall recovery
1. web — ticket table, scheduler view, repo browser, operations
1. nginx — routing config, SSL, docker-compose wiring

-----

## 14. Conventions and Preferences

### 14.1 Code Style

- Concise over verbose. No wrappers that only rename.
- Readable naming — reads like prose at the call site.
- No contrived abstraction. Earn every function and module.
- Default to simple. Complexity only when the problem demands it.
- TypeScript strict mode, `exactOptionalPropertyTypes: true`. No `any`.

### 14.2 Service Conventions

- Each service is fully independent. No shared code, no shared types.
- Each service defines its own types locally. Duplication is acceptable. Coupling is not.
- Service names are singular: project, ticket, repo, sandbox, agent.
- HTTP verbs are standard REST. Action endpoints (`/claim`, `/done`, `/fail`) are acceptable for internal APIs.

### 14.3 Architecture Preferences

- HTTP is the only inter-service communication mechanism.
- No service calls another service's database.
- No shared filesystem except through the repo service.
- Sandboxing is always on. No code path bypasses Podman.
- Observability deferred. Add it when needed.

### 14.4 UI Preferences

- Mobile-first. Primary device is a phone.
- Observation and override only. No domain logic in the UI.
- Dark, dense, terminal-adjacent aesthetic.
- Fonts: Syne (headings), JetBrains Mono (metadata/IDs/timestamps), Lora (body).
- Tailwind utility classes only. No runtime CSS-in-JS.
- Ticket list is a filterable table, not a kanban board.
- Ticket detail slides up from the bottom on mobile (sheet pattern).
- `h-dvh` for full-height containers.

### 14.5 Testing Preferences

- vitest + supertest for all services.
- In-memory SQLite for test databases — fast, no cleanup required.
- Tools are tested in isolation via `tool.execute(params)` — no agent session needed.
- Get tests green at each build phase before moving to the next.

-----

## 15. Open Questions

- **Ticket provider abstraction.** The ticket service interface is designed so the backing store can be swapped (Linear, GitHub Issues, Jira). What does the adapter interface look like, and when does it get built?
- **Agent session streaming.** Should `GET /agent/:id/session/:sid/status` stream via SSE so the UI can show live session progress?
- **Sandbox output persistence.** Should run output be persisted so it can be replayed? Currently lost after container exits.
- **Concurrency within a session.** The tool loop is sequential. Should parallel tool calls be supported?
- **Observability.** When added, which service owns it and what emits events?
- **git push auth.** Currently unauthenticated (internal network only). Needs auth if the repo is ever exposed.
- **node-git-server maintenance.** Lightly maintained. Evaluate before committing. Fallback: shell out to `git http-backend`.
