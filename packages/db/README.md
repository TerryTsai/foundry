# @foundry/db

Drizzle ORM + SQLite schema + per-entity query helpers. Infrastructure module — anything that needs persistence imports from here directly (no client-surface intermediation for low-level queries).

This module owns: the drizzle schema (table definitions, indexes, idempotent migrations), the `Db` type, `createDatabase()`, and the legacy per-entity helper functions (`ticketAll`, `eventInsert`, etc.). It does NOT own: domain types (those are in `@foundry/model`), business logic (that's in `crud` and other modules).

See `/ARCHITECTURE.md` for the rules and conventions.
