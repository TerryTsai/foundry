# Foundry

A personal control plane for self-hosted projects and infrastructure. Aggregates the few signals you actually check across services (Forgejo, CI, deploys, monitoring) and dispatches the few actions you take, through a typed agent workforce.

This repository is a TypeScript monorepo. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the conventions every change must follow and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow.

## Layout

```
packages/
├── model         shared types: entities, error unions, Result, Ctx
├── client        typed cross-module surface + bind() + adapters
├── db            drizzle schema + per-entity query helpers
│
├── auth          OAuth login, session JWTs, requireAuth middleware
├── billing       quota / cost (stubbed in v1)
├── crud          entity CRUD: project, ticket, session, agent, connection, attachment
├── analytics     aggregate queries, time-series rollups, usage breakdowns
├── sandbox       podman lifecycle + execution metering
├── mcp           MCP servers (foundry, sandbox, browser, github + 13 vendor providers)
├── engine        agent SDK loop: pipeline middleware, anthropic + vercel engines
├── reconciler    tick loop + policies (dispatch / settle / verdict / retry)
│
├── server        HTTP entry + composition root (only module allowed to import logic modules directly)
├── site          customer-facing React SPA — day-to-day project work
└── admin         admin React SPA — system observability (stubbed in v1)
```

`service/` is a thin wrapper over `@foundry/server` that preserves the systemd / deploy.sh paths.

## Quick start

```sh
# Install dependencies
npm install

# Type-check the entire workspace
npx tsc -b

# Lint, layout, manifest checks
npm run check

# Run the backend (dev, hot-reload)
cd service && npm run dev

# Run the customer SPA (dev, vite)
cd packages/site && npm run dev

# Build everything for production
cd packages/site && npm run build
cd service && npm run build
```

## Conventions in one breath

- Cross-module imports go through `@foundry/client` and `@foundry/model`. Logic modules cannot import each other directly.
- Domain outcomes return `Result<T, E>`. Cancellation, transport, and programmer errors throw.
- Top-level pure functions only in module code. No classes, no closure factories.
- Functions under 10 lines and depth 2 in new packages; legacy migrated code carries grandfathered exemptions.
- Every package has the same shape: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts` (or Vite SPA equivalent).

## License

Private — internal use only.
