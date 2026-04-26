# @foundry/crud

Entity CRUD for Foundry's domain objects: projects, tickets, sessions, agents, connections, and attachments. Owns ownership-aware reads and mutations against the shared database, validation of inbound shapes via the `validators` namespace, and at-rest encryption of connection secrets. Does NOT own the reconciler tick, sandbox executions, or MCP tool catalogs — those live in their respective modules and the route handler composes them on top of these CRUD primitives.

See /ARCHITECTURE.md for the conventions every module follows.
