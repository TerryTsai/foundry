# @foundry/site

The customer-facing React SPA. The day-to-day product surface for founders running their projects, tickets, sessions, agents, and connections.

This module owns: the project shell, ticket lifecycle UI, session/execution drill-downs, settings (agents, connections, projects), authentication UI, the analytics dashboard. It does NOT own: backend logic (lives in the various server modules), system administration tooling (admin SPA — currently stubbed in `@foundry/admin`).

The split between site and admin is an architectural commitment for future scale; today site contains everything and admin is a placeholder.

See `/ARCHITECTURE.md` for the rules and conventions.
