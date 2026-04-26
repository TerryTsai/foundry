# @foundry/analytics

Derived queries over sessions, tickets, executions, and tool calls. Reads only — analytics doesn't write entities. Provides time-series and rollup data for dashboards and per-entity (ticket/agent/session) usage breakdowns.

This module owns: aggregate queries, time-series rollups, usage calculations. It does NOT own: entity writes (that's `crud`), the underlying schema (that's `db`), event/audit storage (that's `crud` writing to the event table).

See `/ARCHITECTURE.md` for the rules and conventions.
