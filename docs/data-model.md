# Foundry Data Model

5 services. 4 databases. 7 tables. 0 derived columns.

Governed by [data-model-spec.md](data-model-spec.md).

---

## Entity-Relationship Overview

```
PROJECT :3001                  AGENT :3005                    SANDBOX :3004
┌──────────┐                   ┌──────────┐
│ project   │─ ─ ─ 1:N ─ ─ ─▶│ agent     │
│           │                  │           │
└──────────┘                   └──────────┘
     ╎ 1:N                          │ 1:N
     ╎ (logical)                    │ (enforced)
     ▼                              ▼
TICKET :3002                   ┌──────────┐        1:N       ┌───────────┐
┌──────────┐─ ─ ─ 1:N ─ ─ ─▶│ session   │─ ─ ─ ─ ─ ─ ─ ─▶│ execution │
│ ticket    │                  │           │                   └───────────┘
│  ↺ parent │                  └──────────┘
└──────────┘                        │ 1:N
     │ 1:N                          │ (enforced)
     │ (enforced)                   ▼
     ▼                         ┌──────────┐
┌──────────┐                   │ message   │
│ comment   │                  └──────────┘
└──────────┘

FILE :3003 — git is the database. No tables.

─────── intra-service FK (enforced by SQLite)
─ ─ ─ ─ cross-service FK (logical, enforced by application)
```

---

## Service: project (:3001)

### project

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `name` | TEXT | NOT NULL | — | Human-readable project name. |
| `status` | TEXT | NOT NULL | `'active'` | `active` or `archived`. |
| `schedule_interval` | INTEGER | NOT NULL | `600` | Seconds between dispatch cycles. |
| `concurrency_limit` | INTEGER | NOT NULL | `3` | Max simultaneous claimed tickets. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601. |
| `updated_at` | TEXT | NOT NULL | — | ISO-8601. |

---

## Service: ticket (:3002)

### ticket

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `project_id` | TEXT | NOT NULL | — | FK → `project.id` (logical). |
| `agent_id` | TEXT | NULL | — | FK → `agent.id` (logical). NULL if unassigned. |
| `title` | TEXT | NOT NULL | — | Short description. |
| `body` | TEXT | NOT NULL | — | Full description, markdown. |
| `status` | TEXT | NOT NULL | `'open'` | `open`, `claimed`, `blocked`, `done`, `failed`. |
| `priority` | INTEGER | NOT NULL | `0` | Higher = higher priority. Dispatch ordering. |
| `parent_id` | TEXT | NULL | — | FK → `ticket.id`. Self-referential. |
| `created_by` | TEXT | NOT NULL | — | `'founder'` or agent name. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601. |
| `updated_at` | TEXT | NOT NULL | — | ISO-8601. |
| `claimed_at` | TEXT | NULL | — | ISO-8601. Set on transition to `claimed`. |

**Invariant:** A ticket cannot transition to `claimed` without `agent_id` being set. This is an application-layer invariant, not a schema constraint.

### comment

Immutable. No `updated_at`.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `ticket_id` | TEXT | NOT NULL | — | FK → `ticket.id` (enforced). |
| `author` | TEXT | NOT NULL | — | `'founder'`, `'system'`, or agent name. |
| `body` | TEXT | NOT NULL | — | Markdown content. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601. |

---

## Service: agent (:3005)

### agent

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `project_id` | TEXT | NOT NULL | — | FK → `project.id` (logical). |
| `name` | TEXT | NOT NULL | — | Unique within project. |
| `model` | TEXT | NOT NULL | — | Model identifier, e.g. `'claude-sonnet-4-20250514'`. |
| `prompt` | TEXT | NOT NULL | — | System prompt. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601. |
| `updated_at` | TEXT | NOT NULL | — | ISO-8601. |

**Unique constraint:** `(project_id, name)`.

### session

Process lifecycle: `started_at` / `ended_at`. No `created_at` / `updated_at`.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `ticket_id` | TEXT | NOT NULL | — | FK → `ticket.id` (logical). |
| `agent_id` | TEXT | NOT NULL | — | FK → `agent.id` (enforced). |
| `status` | TEXT | NOT NULL | `'running'` | `running`, `done`, `failed`. |
| `model` | TEXT | NOT NULL | — | Snapshot. The agent's model may change; this records what ran. |
| `error` | TEXT | NULL | — | Error message if `failed`. NULL otherwise. |
| `tokens_in` | INTEGER | NULL | — | Total input tokens consumed. Measurement, not derivation. |
| `tokens_out` | INTEGER | NULL | — | Total output tokens generated. Measurement, not derivation. |
| `cost_usd` | REAL | NULL | — | Estimated cost in USD. Measurement, not derivation. |
| `duration_ms` | INTEGER | NULL | — | Wall-clock duration. Pragmatic concession (documented). |
| `started_at` | TEXT | NOT NULL | — | ISO-8601. |
| `ended_at` | TEXT | NULL | — | ISO-8601. NULL while running. |

### message

Immutable. No `updated_at`.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `session_id` | TEXT | NOT NULL | — | FK → `session.id` (enforced). |
| `role` | TEXT | NOT NULL | — | `'user'`, `'assistant'`, `'founder'`. |
| `content` | TEXT | NOT NULL | — | Message content. |
| `tokens` | INTEGER | NULL | — | Token count. NULL for user/founder messages. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601. |

---

## Service: sandbox (:3004)

### execution

Process lifecycle: `started_at` / `ended_at`. No `created_at` / `updated_at`.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | TEXT | NOT NULL | — | PK. nanoid. |
| `session_id` | TEXT | NULL | — | FK → `session.id` (logical). NULL for ad-hoc. |
| `command` | TEXT | NOT NULL | — | Shell command executed. |
| `status` | TEXT | NOT NULL | `'running'` | `running`, `done`, `failed`. |
| `exit_code` | INTEGER | NULL | — | Process exit code. NULL while running. |
| `stdout` | TEXT | NULL | — | Captured standard output. |
| `stderr` | TEXT | NULL | — | Captured standard error. |
| `duration_ms` | INTEGER | NULL | — | Wall-clock execution time. |
| `timeout_ms` | INTEGER | NOT NULL | — | Configured timeout for this execution. |
| `memory_mb` | INTEGER | NULL | — | Memory limit in MB. NULL if no limit. |
| `started_at` | TEXT | NOT NULL | — | ISO-8601. |
| `ended_at` | TEXT | NULL | — | ISO-8601. NULL while running. |

---

## Service: file (:3003)

No database. Git repositories stored as `{basePath}/{project-slug}.git`. Git is the source of truth. See [data-model-spec.md](data-model-spec.md) for rationale.

---

## Cross-Service FK Summary

All cross-service foreign keys are logical — not enforced by SQLite constraints (they span different database files). Application-layer validation is required.

| From | Column | To | Enforced |
|------|--------|----|----------|
| `ticket.project_id` | → | `project.id` | Logical |
| `ticket.agent_id` | → | `agent.id` | Logical |
| `agent.project_id` | → | `project.id` | Logical |
| `session.ticket_id` | → | `ticket.id` | Logical |
| `execution.session_id` | → | `session.id` | Logical |

## Intra-Service FK Summary

| From | Column | To | Enforced |
|------|--------|----|----------|
| `ticket.parent_id` | → | `ticket.id` | SQLite REFERENCES |
| `comment.ticket_id` | → | `ticket.id` | SQLite REFERENCES |
| `session.agent_id` | → | `agent.id` | SQLite REFERENCES |
| `message.session_id` | → | `session.id` | SQLite REFERENCES |
