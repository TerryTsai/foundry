# Foundry v1.3 — Architecture Redesign Handoff

You are picking up a project called **Foundry** — an autonomous project engine for a solo founder running on a home server at `/home/terry/foundry`. The codebase is a TypeScript/Express/SQLite backend + React UI.

**Current state:** A v1.2 implementation exists and mostly works but is over-engineered, fragile, and hard to debug. The founder wants a clean-room redesign (v1.3). Do not try to salvage the v1.2 architecture — gut it and rebuild on the new design below. Keep the tech stack (Node 18, TypeScript, Express, better-sqlite3 + Drizzle ORM, React + Vite, Tailwind). Keep the test infrastructure (vitest + supertest, in-memory SQLite test repos).

---

## v1.3 Design — agreed and final

Three DB tables:

```
projects    id, name, slug, status, workspace (path to git repo), agents (JSON: [{name, prompt}])
tickets     id, project_id, title, body (markdown), agent, status, parent_id, notes, created_by, created_at, claimed_at
activity_log  id, project_id, timestamp, event, detail (JSON) — append only
```

No artifact store. Deliverables are files in `workspace/` on disk. The ticket `notes` field is the agent's completion summary.

**Ticket statuses:** `open → claimed → done / failed`; also `blocked` — suspended until a child ticket resolves, then back to `open`.

**Worker (per agent session):**
1. Claim an open ticket matching the agent type (atomic claim)
2. Read `{workspace}/AGENT.md` — the project's living context doc (tech stack, conventions, goals, current state)
3. Build parent chain — collect body + notes from parent → grandparent, for full context
4. Run Claude session with the agent's system prompt + AGENT.md + chain + ticket body
5. Tools available: `read_file`, `write_file`, `run_command`, `create_ticket`, `block_on`
6. Session ends → mark done/failed, write notes to ticket

**`create_ticket(title, body, agent)`** — creates an independent child ticket (fire and forget).

**`block_on(progress_notes, question_title, question_body, agent)`** — creates a child ticket AND suspends the current ticket (`blocked`). When the child is marked done, the parent returns to `open` and gets re-dispatched with the child's resolution in context. This is how agents request founder decisions.

**`AGENT.md`** — founder writes this. Every agent reads it at the start of every ticket. It is the coordination backbone.

**Scheduler:** polls every N seconds, finds open tickets across active projects, dispatches one worker per ticket. Stall recovery on startup (reset claimed tickets with no recent activity back to open). Parallelism: multiple tickets per project can run concurrently.

**What's gone from v1.2:** artifact store, content hashing, blob store, DAG validation, `consumes`/`produces` types, ProjectConfig versioning, MCP server plumbing, task input/output artifact ID coupling, onboarding chat sessions.

**What's kept:** per-project agent definitions with custom prompts, activity log, scheduler with stall recovery, per-project workspace on disk, vitest test suite pattern.

---

## API surface

```
POST   /api/projects                   create project
GET    /api/projects                   list (filter by status)
GET    /api/projects/:id               get
PUT    /api/projects/:id               update (workspace, agents, status)

POST   /api/tickets                    create ticket (founder)
GET    /api/tickets?projectId=         list (filter: agent, status)
GET    /api/tickets/:id                get (with parent chain)
PUT    /api/tickets/:id                update body/notes (founder editing)
POST   /api/tickets/:id/done           founder marks their ticket done with notes
POST   /api/tickets/:id/reopen         reopen a failed ticket

GET    /api/projects/:id/files         list workspace files (recursive)
GET    /api/projects/:id/files/*       read a file
POST   /api/projects/:id/files/*       write a file (founder)

GET    /api/admin/run/:projectId       trigger immediate scheduler run
GET    /api/activity?projectId=        activity log
GET    /api/health
```

---

## UI (minimal)

- Project list → create project (name, workspace path, initial agents)
- Per-project ticket board — columns: open, in-progress (claimed), blocked, done/failed
- Ticket detail — read body + parent chain, write notes, mark done (for founder tickets)
- File browser — navigate and read workspace files
- Activity feed

---

## Implementation instructions

1. Read `docs/system-design-v1.2.md` for full prior context if needed
2. Check `src/__tests__/helpers/repo.ts` to understand the test DB helper pattern — replicate this for v1.3
3. Run `npm test` to confirm green baseline before touching anything
4. Wipe the v1.2 schema and implementation — do not attempt backwards compatibility
5. Implement in phases: schema + repository layer → API → scheduler + worker → UI. Get tests passing at each phase before moving on.

The founder is technical, runs this on a home server, and wants something they can actually trust to run autonomously. Simplicity and debuggability over cleverness.
