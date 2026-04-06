# Foundry Data Model — Canonical Specification

This document defines the laws governing the Foundry foundational data model. Every table name, column name, type decision, and structural choice flows from these rules. If a rule produces a name you find aesthetically displeasing, the rule wins. Consistency is not negotiable.

This is a foundational model. It stores facts. It is not ergonomic — it is correct. Ergonomics are layered on top via views, APIs, and application logic.

---

## Law 1: Singular Table Names

Tables are named for what ONE ROW represents. A row in `ticket` is a ticket.

- **Always:** `project`, `ticket`, `session`, `message`
- **Never:** `projects`, `tickets`, `sessions`, `messages`

## Law 2: No Service Prefixes

Table names do not carry their service name. The database boundary IS the namespace. Each service owns its own SQLite file. Name collisions across services are impossible.

- **Always:** `agent`, `session`, `message`, `execution`, `comment`
- **Never:** `agent_definition`, `agent_session`, `agent_message`, `sandbox_run`, `ticket_comment`

## Law 3: One Word Per Concept

The system has exactly one word for each concept:

| Concept | Word | Never |
|---------|------|-------|
| A named, reusable agent configuration | `agent` | definition, config, template |
| A multi-turn conversation executing a ticket | `session` | run, job, instance, attempt |
| A single atomic command invocation in a sandbox | `execution` | run, task, invocation |
| An observation on a ticket | `comment` | note, annotation, remark |

## Law 4: Foreign Keys Are `{referenced_table}_id`

Always. No abbreviations. No aliases. The FK column name tells you exactly which table it points to without ambiguity.

- **Always:** `project_id`, `ticket_id`, `session_id`, `agent_id`
- **Never:** `agent_def_id`, `def_id`, `proj_id`

Self-referential FKs use a domain-specific name: `parent_id` on `ticket`.

## Law 5: Primary Key Is Always `id`, TEXT, nanoid

Every table has a column named `id`. It is `TEXT`. It is populated with `nanoid()`. No UUIDs (too long). No auto-increment integers (no portability, no distributed safety). No composite primary keys.

## Law 6: Timestamps Are ISO-8601 TEXT, Named `{past_tense_verb}_at`

All timestamps are ISO-8601 strings stored as TEXT.

The rules for which timestamps a table gets:

1. **Every table** gets `created_at`.
2. **Every mutable table** gets `updated_at`.
3. **Process tables** (session, execution) get `started_at` and `ended_at` INSTEAD of `created_at`/`updated_at`. The row is created when the process starts, so `started_at` IS the creation time. The process is not "updated" — it runs and then it ends.
4. **Immutable tables** (comment, message) get `created_at` only. No `updated_at`. You do not edit comments. You add new ones.
5. **Domain-specific event timestamps** are acceptable when they represent a discrete, meaningful state transition: `claimed_at` on `ticket`.

## Law 7: Status Values Are Consistent Per Lifecycle Type

Status is stored as TEXT. The allowed values follow strict rules by category:

| Lifecycle | Values | Used by |
|-----------|--------|---------|
| Static entity | `active`, `archived` | `project`, `agent` |
| Work item | `open`, `claimed`, `blocked`, `done`, `failed` | `ticket` |
| Process | `running`, `done`, `failed` | `session`, `execution` |

There is no `pending`. No `completed`. No `success`. No `error`. These words are not used.

## Law 8: No Derived Data

If a value can be computed from other rows, it does not get a column.

- Attempt count? `SELECT COUNT(*) FROM session WHERE ticket_id = ?`
- Message count? `SELECT COUNT(*) FROM message WHERE session_id = ?`
- Commit count? `git rev-list --count HEAD`

The foundational model stores facts. Derived values are for views, APIs, and caches.

## Law 9: No Application-Level Concerns

`slug` is a URL-routing concern derived from `name` by a deterministic function. It does not belong in the data model. nanoid is already URL-safe.

Configuration fields that are user-specified and cannot be derived (`schedule_interval`, `concurrency_limit`) DO belong.

## Law 10: NULL Means Absent

If a column can legitimately have no value, it is nullable. If it must always have a value, it is NOT NULL. Never use `default('')` as a substitute for NULL. An empty string is a value. NULL is the absence of a value.

## Law 11: Measurements Are Not Derivations

Token counts, cost, and duration are recorded facts returned by external systems (the Anthropic API, the OS process). They cannot be recomputed without replaying the conversation or re-executing the command. They are measurements. They belong on the row.

`duration_ms` is technically derivable from `ended_at - started_at`, but ISO-8601 arithmetic in SQLite is painful. This is one documented, pragmatic concession.

## Law 12: Every Entity Justifies Its Existence

If an entity is just a key-value pair hanging off another entity, it is a column, not a table. `error` is a column on `session` because there is at most one per session. `comment` is a table because comments are unbounded, ordered, and independently authored.

---

## What Is Excluded and Why

### Observability tables (event logs, dispatch logs)

Events and dispatch logs are operational infrastructure. They are append-only, high-volume, and serve monitoring — not domain logic. They do not participate in FK relationships. They do not have the same retention guarantees. They are a different category of data. Add them as operational tables outside this specification.

### File service tables

Git IS the database for the file domain. A `file_commit` table would duplicate `git log`. This creates a synchronization problem with zero benefit. The git repository is the data model for files.

### Slug on project

`slugify(name)` is a deterministic derivation, not data. Compute it in the route layer.
