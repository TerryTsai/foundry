# Architecture

The conventions, module structure, and design rules that govern this codebase. Decisions in here are load-bearing — changing them isn't a personal preference call, it's a coordinated migration. Read this before adding a new module, a new cross-module call, a new error type, or a new client method.

## Why these rules exist

Foundry is built to be **forkable on demand**: any logic module should be extractable into its own service with minimal effort, ideally touching nothing beyond a new server wrapper and a config flip. That goal only survives if the rules below are enforced from day one.

The recurring failure mode we're avoiding: convenient coupling that ships fast (shared interfaces, shared ctx, cross-module imports) and turns into a refactor wall when modules need to separate. "Decouple later" is theoretical; refactor pain is real. Design transport-shaped boundaries up front.

## Consistency is a load-bearing tenet

Every module looks the same. Every file looks the same. Every function looks the same. A reader landing on any module should not have to learn its idioms — predictable structure means cognitive cost stays flat as the codebase grows.

The standard for readability is **5-second gist**: a reader should be able to understand what a file does in five seconds. Not "walk through line by line" — *gist*. If they need more than five seconds to figure out the shape of a function or what a file owns, the file or function is too clever.

This applies to file naming, file structure, function shape, and naming conventions. Drift is not allowed.

## Repetition over abstraction

Each AI session arrives without memory of how previous sessions chose to factor things. A clever DRY abstraction one session creates, the next session won't recognize and may duplicate or rewrite differently. Repetition has zero machine cost and infinite consistency value — the same literal in three places will always be obvious; an extracted `THRESHOLD` const may or may not be the same one a future session would have created.

At this speed and scale, **mechanically-enforced consistency is the only thing that survives.** DRY is a human-collaboration optimization that backfires when half your collaborators are stateless.

Concretely:
- **Inline over named constants.** Don't extract a literal into a module-level const just because it appears twice. Write `10_240` in three places. The literal is its own name.
- **Hardcode at the use site or thread through a parameter.** Both options are explicit. A named module-level const is neither — it's a hidden indirection that varies session-to-session.
- **Enforced by ESLint** in logic-module feature files: `no-restricted-syntax` blocks `Program > VariableDeclaration` (no module-level `let`/`const`/`var`). Schema files (`schema.ts`, mcp `tools.ts`) and the composition root (`server`) are exempt.

## Repository layout

```
foundry/
├── model/         shared types — entities, error unions, Ctx, Result
├── client/        typed cross-module surface + bind() + adapters
├── db/            drizzle schema + per-entity query helpers
├── mcp/           MCP servers (top-level today; layout is being reworked)
├── site/          customer-facing React SPA
├── service/       logic modules — each forkable on demand
│   ├── auth/        OAuth, session JWTs, requireAuth middleware
│   ├── billing/     quota / cost (stubbed in v1)
│   ├── crud/        entity CRUD
│   ├── analytics/   aggregate queries / dashboards
│   ├── sandbox/     podman lifecycle + execution metering
│   ├── engine/      agent SDK loop (Anthropic + Vercel SDKs)
│   └── reconciler/  tick loop + policies
└── server/        composition root + HTTP entrypoint (binary)
                   systemd unit, deploy.sh, env, sqlite db live here
```

`server/` owns wiring; everything else is library code. `mcp` sits at
the top level alongside the infrastructure libs because its internal
shape differs from the other logic modules — it's being reworked
separately and will likely move once that's settled.

## Files come in two shapes

Every logic-module file is one of two shapes — declarations or behavior, never both:

```
<module>/src/
├── index.ts       ← re-exports the public surface
├── schema.ts      ← every shape: zod schemas, inferred types, interfaces, error unions, lookup constants
├── feature1.ts    ← functions only — no types, no constants, no module-level state
├── feature2.ts    ← functions only
└── ...
```

(`<module>` here means a service/logic-module directory under `service/`,
or one of the top-level libs `model/`, `client/`, `db/`, `mcp/`.)

`schema.ts` holds:
- Zod schemas (`export const ticketCreate = z.object(...)`)
- Types inferred from those schemas (`export type TicketCreate = z.infer<typeof ticketCreate>`)
- TS interfaces and type aliases (boundary or internal)
- Discriminated error unions (`type CrudError = ...`)
- Module-wide constants and lookup tables

Feature files contain only:
- `import` statements (external → `@foundry/*` → `./schema.js` → relative)
- `export function name(...) { ... }` declarations
- Nothing else at module scope

This is enforced mechanically. ESLint blocks top-level `interface`, `type`, `let`, `const`, and `var` in feature files. Zod imports are restricted to `schema.ts` and mcp `tools.ts` files.

Wiring (registries, lifecycle intervals, env reads, runtime state caches) lives in `@foundry/server`. Logic modules export pure functions; the composition root wires them.

The intuition: **`schema.ts` is the module's vocabulary, feature files are its verbs, `index.ts` is its facade.**

Cross-module shared shapes still live in `@foundry/model` (the promotion rule: a type goes in model only when at least two modules need it).

## Code style

These rules are non-negotiable for module code. Adapter and infrastructure code (bind, transport wrappers, middleware compose) has explicit exceptions noted at the bottom.

### Top-level pure functions only

```typescript
// REQUIRED: top-level function, deps as explicit args
export async function ticketCreate(
  db: Db, ctx: Ctx, args: TicketCreateArgs,
): Promise<Result<Ticket, CrudError>> {
  // ...
}

// FORBIDDEN: class
export class TicketService {
  constructor(private db: Db) {}
  async create(ctx: Ctx, args: Args) { ... }
}

// FORBIDDEN: closure factory
export function createTicketService(db: Db) {
  return {
    create: async (ctx: Ctx, args: Args) => { ... },
    get:    async (ctx: Ctx, id: string)  => { ... },
  }
}
```

Why: top-level functions are the simplest possible shape. No `this`, no hidden state, no factory plumbing. Every function declares its dependencies in its signature. Easy to test, easy to inspect, easy to understand at a glance.

### Function size: under 10 lines as default

A function that needs more than 10 lines is a sign of two responsibilities pretending to be one. Split. Helpers can be private (non-exported) top-level functions in the same file.

Exceptions:
- Multi-step transactions where decomposing makes the transactional boundary unclear.
- Validation pipelines with many independent guard clauses (still keep each guard one line).
- Top-level middleware/compose declarations.

When you exceed 10 lines, ask: "is the next reader going to get the gist in 5 seconds?" If no, split.

### Minimal nesting

Two levels deep is the default. Three is a smell. Beyond three is forbidden.

```typescript
// FORBIDDEN
if (x) {
  for (const y of ys) {
    if (z) {
      try {
        // ...
      } catch (e) {
        // ...
      }
    }
  }
}

// PREFERRED: early returns, helper functions
if (!x) return err({ kind: 'invalid_x', reason: '...' })
for (const y of ys) {
  if (!z) continue
  await processOne(y)
}
```

### No nested function declarations

Helper functions are top-level in the same file (not exported). Never declared inside another function unless it's a one-line callback to a higher-order function (`xs.map(x => x.id)`).

### File structure (every module file looks the same)

```typescript
// 1. imports — group: external, then @foundry/*, then relative
import { z } from 'zod'
import type { Db } from '@foundry/db'
import type { Ctx, Result, Ticket, CrudError } from '@foundry/model'
import { ok, err } from '@foundry/model'
import { auditWrite } from './audit.ts'

// 2. types (module-internal only — shared types live in @foundry/model)
type TicketCreateArgs = { title: string; projectId: string }

// 3. constants
const MAX_TITLE_LENGTH = 200

// 4. functions in flat order, exported first, helpers below
export async function ticketCreate(...): Promise<Result<...>> { ... }
export async function ticketGet(...): Promise<Result<...>> { ... }

async function validateTitle(...): Promise<Result<...>> { ... }   // helper, not exported
```

No surprises. Imports tell you what's in scope. Types tell you the shape. Functions tell you what's available. Always in that order.

### Naming

- Functions: `verbNoun` for unary, `verbNounStream` for streams, `verbNounWait` for long-poll.
- Variables: full words over abbreviations. `ticket`, not `t`. (Exception: loop counters `i`, well-known abbreviations `db`, `ctx`, `id`.)
- Types: PascalCase, singular. `Ticket`, `CrudError`. Plural only when the type is intrinsically a collection.
- Files: kebab-case where there are multiple words (`session-jwt.ts`), single noun for single-concept files (`ticket.ts`).
- Functions over variables when in doubt: `ticketIsRoutable(ticket)` reads better than `ticket.isRoutable` would have.

## File layout per module

```
<module>/
├── package.json
├── tsconfig.json
├── README.md           # one paragraph: what this module owns, what it does NOT own
├── src/
│   ├── index.ts        # public surface: re-exports the functions the adapter wires
│   ├── types.ts        # module-internal types (shared types go in @foundry/model)
│   ├── <feature>.ts    # one file per entity/feature, all top-level functions
│   ├── <feature>.ts
│   └── util.ts         # module-internal helpers (only if non-trivial)
└── tests/
    ├── <feature>.test.ts
    └── ...
```

`src/index.ts` is purely re-exports — no logic. The list of exports IS the module's public surface; the client adapter wires exactly these.

`README.md` is a paragraph. Not a manual. What this module owns, in plain prose. Future readers should land on it and orient in seconds.

### Example: the `crud` module

```
service/crud/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts        # exports: ticketCreate, ticketGet, sessionCreate, ...
│   ├── types.ts        # internal types if any
│   ├── ticket.ts       # ticketCreate, ticketGet, ticketList, ticketTransition, ...
│   ├── session.ts      # sessionCreate, sessionGet, sessionUpdate, ...
│   ├── comment.ts      # commentCreate, commentByTicket, ...
│   ├── verdict.ts      # verdictReport, verdictByTicket, ...
│   └── audit.ts        # auditWrite (helper used across entities)
└── tests/
    ├── ticket.test.ts
    ├── session.test.ts
    └── ...
```

Every other module follows the same shape. Predictable.

## Exceptions for infrastructure code

The following patterns are allowed *only* in infrastructure code (`client/`, transport wrappers, middleware compose). Module logic still follows the rules above.

- **Closures binding deps in adapters**: the in-process client adapter binds module functions with their deps. This is the only place closure-based-factories are allowed; it's literally an adapter's job.

  ```typescript
  // client/src/adapters/crud-inprocess.ts — ALLOWED
  export function createCrudInProcessAdapter(deps: { db: Db }): Client['crud'] {
    return {
      ticketCreate: (ctx, args) => ticketCreate(deps.db, ctx, args),
      ticketGet:    (ctx, id)   => ticketGet(deps.db, ctx, id),
      // ...
    }
  }
  ```

- **Proxy in `bind`**: `bind(client, ctx)` may use a Proxy or hand-written wrapper. It's transport plumbing.

- **Middleware compose** (`compose(mw1, mw2, ...)(handler)`): allowed for pipeline-shaped flows where the linear order is the documentation. Use sparingly.

- **AbortSignal listeners**: registering teardown via `signal.addEventListener('abort', ...)` is fine. Cancellation handling is infra.

These exceptions are tightly scoped. Logic modules cannot smuggle in classes or factories by claiming "infrastructure."

## Module layout

```
foundry/
├── model/         shared types (entities, error unions, Ctx, Result, primitives)
├── client/        typed cross-module surface + bind() + adapters
├── db/            drizzle, schema, query helpers
├── mcp/           MCP servers (stdio child processes for v1)
├── site/          customer-facing React SPA
│
├── service/       logic modules
│   ├── auth/        session JWTs, OAuth flows, account/user resolution
│   ├── crud/        entity CRUD (incl. attachments storage for v1)
│   ├── analytics/   derived queries, aggregates, dashboards
│   ├── reconciler/  tick loop + policies (no LLM deps)
│   ├── engine/      agent SDK loop (Anthropic + Vercel SDKs live here)
│   ├── sandbox/     podman lifecycle + exec (incl. execution metering for v1)
│   └── billing/     quota/cost (stubbed v1; real impl later)
│
└── server/        composition root + HTTP entrypoint (binary)
                   systemd unit, deploy.sh, env, sqlite db all live here
```

`server/` is the only directory that wires logic modules together; it
also owns on-disk artifacts (env file, PEM, SQLite db, sandbox
Dockerfile). Logic modules live under `service/` so the boundary is
visually obvious — every `service/<name>` is forkable on demand.

`mcp/` sits at the top level today rather than under `service/` because
its internal layout differs from the other logic modules (per-provider
subtrees, hand-rolled tool registration). It will likely move once that
shape is reworked.

### Borderline decisions, named so future-you knows where the seam will go

- **`attachments` is folded into `crud`** until storage backend diverges from primary DB.
- **`executions` is folded into `sandbox`** until non-sandbox metering arrives.
- **`events` is intentionally absent.** Explicit calls beat implicit pub/sub. `crud` writes its own audit/event rows; `analytics` queries them.
- **`engine` is split from `reconciler`.** Their dependency trees are very different (engine pulls in heavy LLM SDKs; reconciler stays light). Keeping reconciler forkable later requires this split now.
- **`billing` is stubbed.** Empty interface in `client` so wiring is in place; real impl when quota work begins.

## The cardinal rule: cross-service value imports forbidden

> A logic module may import VALUES only from `@foundry/model`, `@foundry/db`, and its own external dependencies. Cross-service imports of peer logic modules are TYPE-ONLY (the typed contract from `@foundry/<peer>/client` or its index), never runtime.

The eight logic modules: `auth`, `billing`, `crud`, `analytics`, `sandbox`, `mcp`, `engine`, `reconciler`.

The two infrastructure foundations — `model` and `db` — are freely importable. There is no aggregate `@foundry/client` package; per-service contracts live with each service.

### The per-service shape

Every service follows the same five-file pattern:

```
service/<name>/src/
├── index.ts      re-exports the public surface
├── schema.ts     types, error union, internal interfaces (no zod runtime)
├── validate.ts   zod schemas + zod-inferred types (only home for zod runtime)
├── client.ts     XxxClient interface — TYPES ONLY, no runtime exports
├── service.ts    createXxxService(deps): XxxClient — wiring
└── <feature>.ts  pure functions; take typed args
```

`package.json` publishes subpath exports so consumers can import the contract narrowly:

```json
"exports": {
  ".":          "./src/index.ts",
  "./client":   "./src/client.ts",
  "./service":  "./src/service.ts",
  "./validate": "./src/validate.ts"
}
```

`mcp` is currently a borderline case (top-level placement, internal layout differs). It exposes the same shape but its internal restructure is pending.

### Persistence boundary: only `crud` and `analytics` may import `@foundry/db`

`@foundry/db` exposes drizzle schema, the `Db` connection handle, `createDatabase`, and entity row types. The per-entity query helpers (ticketGet, sessionInsert, eventInsert, executionUpdate, …) live in `@foundry/crud`. Logic modules other than crud and analytics MUST NOT runtime-import `@foundry/db` — they receive persistence through `CrudClient` (the typed cross-service surface) or, for engine/reconciler internals that haven't migrated yet, through legacy `*CrudOps` callback bags the composition root constructs.

`analytics` is a deliberate, bounded exception. Its dashboards run hand-written SQL aggregates that don't fit the per-entity helper surface; threading those through crud callbacks would invert the shape and cost legibility. The rule for analytics is **read queries only**: any analytics writes must go through crud. The manifest check enforces "non-{crud,analytics} logic modules cannot value-import @foundry/db" mechanically.

Exceptions:
- `server` is the composition root. It imports logic-module implementations directly to call each `createXxxService(deps)`. No other module gets this exemption.

This rule is what makes "fork out on demand" possible. Cross-service work flows through the typed `XxxClient` (passed in via `createXxxService` deps) — never through direct imports of peer implementations.

### Enforcement (mechanical, not discipline-based)

1. **TypeScript project references** — module A's `tsconfig.json` `references` does not include module B unless A actually depends on B. In practice: only `model` and `db` appear in cross-module references.
2. **ESLint `no-restricted-imports`** — peer-package value imports are blocked; type-only imports are allowed (`allowTypeImports: true`).
3. **ESLint `client.ts` enforcement** — runtime exports (functions, consts, default exports) blocked in any `client.ts` file. Drives the contract to types only.
4. **CI manifest check** — a script parses imports and confirms they match `package.json` declared dependencies. Build fails on mismatch.

If these aren't in place, the rule isn't enforced. Discipline alone won't hold past the third time someone is in a hurry.

## The per-service `XxxClient` abstraction

Every cross-service call goes through a typed `XxxClient`. There is no aggregate `Client` — boundaries import the per-service clients they need.

### Async always

Every client method returns a `Promise<Result<T, E>>` or an `AsyncIterable<Result<T, E>>`. Even when the in-process service calls a synchronous function. **No exceptions** — synchronous methods break the in-process-to-remote flip.

### Bound clients (the ctx pattern)

Ctx is explicit at the type level but invisible at most call sites. You bind once at a unit-of-work boundary; downstream code uses the bound client.

```typescript
// model
type Ctx = {
  accountId:  AccountId         // 'system' for bootstrap
  traceId:    string            // request/work-unit correlation
  deadline?:  number            // epoch ms; undefined = no deadline
  signal:     AbortSignal       // cancellation
  now:        () => number      // injectable time source
}

// per-service client
type CrudClient = {
  ticketCreate: (ctx: Ctx, args: TicketCreateArgs) => Promise<Result<Ticket, CrudError>>
  // ...
}

// bind() in @foundry/model — generic over any service client shape
function bind<T>(client: T, ctx: Ctx): Bound<T>
```

```typescript
// boundary — bind once per service you need
async function handleCreateTicket(req: Request) {
  const ctx  = ctxFromRequest(req)
  const crud = bind(crudClient, ctx)

  const r = await crud.ticketCreate({ title: req.body.title })
  if (!r.ok) return errorResponse(r.error)
  return ok(r.value)
}
```

Boundaries (the only places `bind` is called):
- HTTP request handlers in `server`
- Reconciler tick start
- Session start
- Background job start
- Test setup

Greppable: `bind(` finds every "unit of work starts here" marker.

### Ctx contents — locked

Ctx contents are fixed. Adding to Ctx is a coordinated change.

What's in Ctx:
- Things every module call needs (auth, tracing, deadline, cancellation).
- Things that must serialize across process boundaries (so HTTP adapters can carry them as headers).

What's NOT in Ctx:
- `db`, `config`, `secrets`, `logger`. Those are composition-root concerns, injected at module construction.
- Request bodies, user-agent, cookies. Boundary-specific data.
- Async-local-storage equivalents. Hidden state breaks the moment we go remote.

## Result, errors, throws

### Result shape

```typescript
type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

const ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

// test/script-only helper
const unwrap = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(`unwrap on err: ${JSON.stringify(r.error)}`)
  return r.value
}
```

That is the entire API. **Do not add `.map`, `.andThen`, `.mapErr`, `.match`, etc.** The point of Result is errors-are-visible-data; chained transforms re-introduce the implicit flow that throwing has.

### Why hand-rolled, not `neverthrow`/`fp-ts`

- Serializes natively. `JSON.stringify(result)` is the wire shape; HTTP adapter sends it as the body, no transformation, no re-instantiation on the other side.
- Zero runtime, zero dependency, zero class hierarchy.
- TS narrows perfectly with `if (r.ok)` / `if (!r.ok)`.
- Forces explicitness at every call site.

### Per-module error unions

Each module's error type is a discriminated union with a `kind` field.

```typescript
type CrudError =
  | { kind: 'not_found';          entity: string; id: string }
  | { kind: 'permission_denied';  reason: string }
  | { kind: 'validation_failed';  field: string; reason: string }
  | { kind: 'conflict';           reason: string }
  | { kind: 'internal';           message: string }
```

Rules:
- Every variant carries `kind: '<snake_case>'`.
- All variant fields must be JSON-serializable. **No `Error` objects, no functions, no class instances, no `cause: unknown` blobs.** Capture stack traces as strings if needed.
- Adding a variant is additive; consumers get TS errors at exhaustive switches and update accordingly.
- `Result<T>` with a default `E = string` is forbidden. Every module declares its error union.

### Throw vs Result — the divide

| Category | Mode | Examples |
|---|---|---|
| Domain — caller might reasonably react differently | `Result.err` | `not_found`, `permission_denied`, `validation_failed`, `conflict`, `quota_exceeded` |
| Cancellation | throw `AbortError` | ctx.signal aborted, deadline exceeded |
| Transport | throw | HTTP 5xx, connection refused, JSON parse failure on response |
| Programmer error | throw | invariant violations, schema mismatches that should never happen |

Module code never throws domain errors. Boundaries (HTTP handlers, tick loops, session entries) catch the throw cases and convert to top-level error responses.

### HTTP mapping for the client adapter

- **HTTP 200** + body = the Result, ok or err. Both branches are 200s; the `error` field tells the caller what happened.
- **HTTP 4xx/5xx** = transport-level failure. Thrown on the client side.
- `not_found` is **not** HTTP 404. It's HTTP 200 with `{ ok: false, error: { kind: 'not_found', ... } }`. Keep transport semantics and domain semantics on separate channels.

(Public REST APIs for third parties are a different surface where HTTP semantics matter. The internal client surface stays Result-shaped.)

## Streaming

Streaming methods return `AsyncIterable<Result<T, E>>` — no outer Result wrapper.

```typescript
crud: {
  activityStream(sessionId: string): AsyncIterable<Result<Activity, CrudError>>
}
```

Rules, applied consistently with unary calls:
- **Construction errors are item-level.** A stream that can't open yields one `Result.err` and ends.
- **Mid-stream item errors are item-level.** Single bad row → `Result.err`, stream continues.
- **Transport errors throw from the iterator.** Connection died → throw.
- **Cancellation throws AbortError from the iterator.** ctx.signal abort propagates.
- **Pull-based, no explicit backpressure.** AsyncIterable + TCP gives natural flow control. Producers must be lazy generators.

## Naming conventions

Client method names follow shape:

| Shape | Naming | Returns |
|---|---|---|
| Unary | `verbNoun` (`ticketCreate`, `sessionGet`) | `Promise<Result<T, E>>` |
| Streaming | `verbNounStream` (`activityStream`, `ticketWatch` for legacy) | `AsyncIterable<Result<T, E>>` |
| Long-poll / wait | `verbNounWait` | `Promise<Result<T, E>>` (may take a while) |

Discipline on naming keeps the surface scannable as it grows.

## One client per service

`crudClient.X` — that is the entire public surface of `crud`. There is no `crudClientInternal`, no `crudClientV2`, no escape hatch. If a method shouldn't be on the client, it doesn't exist on the client; it's a private function inside the module's source.

The client is the entire public surface; nothing leaks past it.

## Composition root

`server` is the only module that imports logic-module implementations directly. It:

1. Reads config from env.
2. Calls each service's `createXxxService(deps)`, injecting direct dependencies (`db`, config, peer typed clients, etc.).
3. Mounts route handlers (which today still call raw module functions; future migration moves them behind `bind(client, ctx)`).
4. Starts the HTTP server (web UI, API, callback API for MCP servers).

Transport choice is per-service, config-driven (future):

```
FOUNDRY_CRUD_TRANSPORT=in-process       # default — createCrudService
FOUNDRY_CRUD_TRANSPORT=http             # createCrudHttpClient(url)
FOUNDRY_CRUD_URL=http://crud-service.internal:7011
```

When a service is forked out, server swaps `createCrudService` for `createCrudHttpClient`. No other service touches anything — the `CrudClient` interface is the inter-service contract.

## `model` — bottom of the dependency graph

`model` depends on nothing except optionally `zod` for runtime validation schemas. Everything else can depend on `model`.

Contents:
- **Entity types**: `Ticket`, `Session`, `Agent`, `Project`, `Account`, `Connection`, `Comment`, `Verdict`, `Activity`, `Attachment`. Domain shapes — *not* DB row shapes.
- **`Ctx`, `Result<T,E>`, `ok`, `err`, `unwrap`, `bind`**.
- **Primitive aliases**: `Ulid`, `Timestamp` (ISO string), branded ID types.
- **Zod schemas** (optional, for boundary validation).

Per-service error unions (`CrudError`, `AuthError`, etc.) live in each service's `schema.ts` and are re-exported by its `index.ts`. Cross-service consumers type-import them from the peer service.

Promotion rule: a type goes in `model` only when at least two modules need it. Single-module types stay internal.

## Versioning

**Single repo version. No per-module semver. No `client.v1` API surface.**

- Pre-fork-out: break the client interface freely. Type system catches consumers.
- Post-fork-out: that module's client surface is now an inter-service contract. Standard API evolution rules — additive only, no field removals, no required-arg additions, no semantic changes. Use `kind` discriminators to extend error unions safely.

Don't pay this cost until you actually fork something out.

## Cross-module callback bridges

Some logic modules need functions that live in other logic modules — for example, `auth` needs the github OAuth helpers in `mcp`, `sandbox` needs ownership checks from `crud`, `engine` needs many things from `mcp`/`sandbox`/`crud`. The cardinal rule forbids the direct import.

The dominant pattern is the typed peer client: a service that needs another service receives the peer's `XxxClient` (async/Result, the canonical contract) via its `createXxxService(deps)` call. The composition root constructs each peer service first and threads the resulting client in.

Some cross-service surfaces aren't shaped like a typed client — runtime helpers (sandbox container lifecycle, mcp tool servers, mcp utility helpers) don't fit the `(ctx, args) => Promise<Result>` mold. For those, the consumer still declares a small callback interface and the composition root injects the function references. The legacy `*CrudOps` callback bags inside `engine` and `reconciler` are a residual case of this — they predate the typed `CrudClient` and will collapse into it as those services migrate their internals to async-Result.

Example: `engine`'s `createEngineService(deps)` accepts a `CrudClient` plus the runtime-only `mcp` and `sandbox` helpers it needs. Engine never knows which logic module supplied them; it sees only the function shapes it declares.

## Code-style enforcement

Module code (every package's `src/`) is held to a single rule set: top-level pure functions, depth ≤ 2, function length ≤ 20 lines after the strict-10-line target plus a small overhead for signatures and the closing brace. The 5-second-gist bar is what reviewers actually enforce; the lint cap catches drift past it.

`Result<T, E>` is the only domain-error mechanism. Modules return `Result` natively; each service's `service.ts` is a pass-through wrapper that adapts ctx-shape and exposes the typed client. Throws are reserved for transport, cancellation, and programmer error per the rules above.

Adding an `eslint-disable` to module code is a code-review red flag. The few that exist today are non-legacy (SDK boundary types, single-aggregate SQL, composition-root callback bags, db migrations) and carry rationales that explain why the rule legitimately doesn't fit.

## Ground rules summary

1. Cross-service value imports forbidden; type-only imports of peer services are fine. Enforced by ESLint `allowTypeImports`.
2. Infrastructure foundations (`model`, `db`) are freely importable.
3. Async-always at the cross-service client boundary.
4. `Result<T,E>` for domain outcomes; throws for transport, cancellation, programmer error.
5. Per-service discriminated error unions in each `schema.ts`, fully serializable, no `Error` objects.
6. Streams as `AsyncIterable<Result<T,E>>` — same rules, no outer Result.
7. `bind(client, ctx)` once per unit of work; no AsyncLocalStorage.
8. `server` is the only composition root — calls each `createXxxService(deps)`. All other modules are agnostic to wiring.
9. `model` depends on nothing (except optionally zod). Promotion to `model` requires multiple consumers.
10. No `.map`, `.andThen`, `.match` on Result. Verbosity is the point.
11. No HTTP-mapped domain errors. HTTP 200 carries Result; non-200 is transport-only.
12. Top-level pure functions in feature files. No classes; closure-based factories permitted only in `service.ts` (the wiring file).
13. Functions under 10 lines as default. Two levels of nesting max.
14. Every service has the same five-file shape: `index.ts`, `schema.ts`, `validate.ts` (when zod is needed), `client.ts` (types only), `service.ts` (wiring), plus feature files.
15. `client.ts` is types only — runtime exports blocked by ESLint.

When in doubt, ask: "if I forked this module out tomorrow, would this code still work?" If the answer is "I'd need to refactor first," the rule is being violated.

The second question to ask: "can a new reader land on this file and get the gist in five seconds?" If no, the file is too clever.
