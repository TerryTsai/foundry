# Foundry

A personal control plane for self-hosted projects and infrastructure. Aggregates the few signals you actually check across services (Forgejo, CI, deploys, monitoring) and dispatches the few actions you take, through a typed agent workforce.

This repository is a TypeScript monorepo. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the conventions every change must follow and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow.

## Layout

```
model/         shared types: entities, error unions, Result, Ctx
client/        typed cross-module surface + bind() + adapters
db/            drizzle schema + per-entity query helpers
mcp/           MCP servers (foundry, sandbox, browser, github + 13 vendor providers)
site/          customer-facing React SPA — day-to-day project work

service/       logic modules — each forkable on demand
├── auth          OAuth login, session JWTs, requireAuth middleware
├── billing       quota / cost (stubbed in v1)
├── crud          entity CRUD: project, ticket, session, agent, connection, attachment
├── analytics     aggregate queries, time-series rollups, usage breakdowns
├── sandbox       podman lifecycle + execution metering
├── engine        agent SDK loop: pipeline middleware, anthropic + vercel engines
└── reconciler    tick loop + policies (dispatch / settle / verdict / retry)

server/        composition root + HTTP entrypoint (binary)
               systemd unit, deploy.sh, env, sqlite db all live here
```

The `server/` directory owns the wiring (composition root, env, on-disk
state, deploy artifacts). Logic modules stay decoupled and independently
forkable.

## Quick start

```sh
# Install dependencies
npm install

# Type-check the entire workspace
npx tsc -b server

# Lint, layout, manifest checks
npm run check

# Run the backend (dev, hot-reload)
cd server && npm run dev

# Run the customer SPA (dev, vite)
cd site && npm run dev

# Build everything for production
cd site && npm run build
cd server && npm run build
```

## Conventions in one breath

- Cross-service value imports are forbidden — type-only imports of peer services are allowed. Each service exposes its contract via `<service>/client.ts` (types only) and its wiring via `<service>/service.ts` (the `createXxxService(deps): XxxClient` factory).
- Domain outcomes return `Result<T, E>`. Cancellation, transport, and programmer errors throw.
- Top-level pure functions in feature files. Closure factories only in `service.ts`. No classes.
- Functions under 10 lines and depth 2 in new packages; legacy migrated code carries grandfathered exemptions.
- Every service has the same five-file shape: `index.ts`, `schema.ts`, `validate.ts` (when zod is needed), `client.ts`, `service.ts`, plus per-feature files. Per-service error unions live in `schema.ts`.

## License

Private — internal use only.
