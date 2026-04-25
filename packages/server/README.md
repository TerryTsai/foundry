# @foundry/server

Composition root. The only module allowed to import from logic modules
directly: it loads config from env, opens the database, builds the
cross-module callback bags (ENGINE_DEPS, RECONCILER_DEPS), starts the
reconciler, mounts the HTTP routes, and listens. Entry point is `boot()`
from `src/index.ts` or running `src/main.ts` directly. Owns the HTTP
surface (auth, project, ticket, session, agent, connection, attachment,
execution, analytics) and the future `/api/v1/tool/*` callback API for
out-of-process MCP servers. Does NOT own any domain logic — every route
handler is a thin adapter over `@foundry/{auth,crud,analytics,sandbox,mcp,engine,reconciler}`.

See /ARCHITECTURE.md for the conventions every module follows.
