# @foundry/server

Composition root and HTTP entrypoint. Wiring (env, db handle, callback
bags, route mounting) all happens here. Logic modules live under
`service/`; this is the one place allowed to import them directly.
Run via `tsx src/server.ts` under systemd.

The only module allowed to import from logic modules directly: it
loads config from env, opens the database, builds the cross-module
callback bags (`EngineDeps`, `ReconcilerDeps`), starts the reconciler,
mounts the HTTP routes, and listens. Owns the HTTP surface (auth,
project, ticket, session, agent, connection, attachment, execution,
analytics) and the static SPA fallback for `site/dist`. Does
NOT own any domain logic — every route handler is a thin adapter over
`@foundry/{auth,crud,analytics,sandbox,mcp,engine,reconciler}`.

Local artifacts live alongside the code: `Dockerfile.sandbox`,
`foundry-app.env`, `foundry-app.pem`, `foundry.db*`. The systemd unit
points its `WorkingDirectory` at this folder.

See /ARCHITECTURE.md for the conventions every module follows.
