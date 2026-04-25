# Architecture

The conventions, module structure, and design rules that govern this codebase. Decisions in here are load-bearing — changing them isn't a personal preference call, it's a coordinated migration. Read this before adding a new module, a new cross-module call, a new error type, or a new client method.

## Why these rules exist

Foundry is built to be **forkable on demand**: any logic module should be extractable into its own service with minimal effort, ideally touching nothing beyond a new server wrapper and a config flip. That goal only survives if the rules below are enforced from day one.

The recurring failure mode we're avoiding: convenient coupling that ships fast (shared interfaces, shared ctx, cross-module imports) and turns into a refactor wall when modules need to separate. "Decouple later" is theoretical; refactor pain is real. Design transport-shaped boundaries up front.

## Consistency is a load-bearing tenet

Every module looks the same. Every file looks the same. Every function looks the same. A reader landing on any module should not have to learn its idioms — predictable structure means cognitive cost stays flat as the codebase grows.

The standard for readability is **5-second gist**: a reader should be able to understand what a file does in five seconds. Not "walk through line by line" — *gist*. If they need more than five seconds to figure out the shape of a function or what a file owns, the file or function is too clever.

This applies to file naming, file structure, function shape, and naming conventions. Drift is not allowed.

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
packages/<module>/
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
packages/crud/
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

The following patterns are allowed *only* in infrastructure code (`packages/client`, transport wrappers, middleware compose). Module logic still follows the rules above.

- **Closures binding deps in adapters**: the in-process client adapter binds module functions with their deps. This is the only place closure-based-factories are allowed; it's literally an adapter's job.

  ```typescript
  // packages/client/src/adapters/crud-inprocess.ts — ALLOWED
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
packages/
├── model           shared types (entities, error unions, Ctx, Result, primitives)
├── client          typed cross-module surface + bind() + adapters
│
├── server          HTTP entry + composition root
├── site            customer-facing React SPA
├── admin           admin-facing React SPA
│
├── db              drizzle, schema, query helpers
├── auth            session JWTs, OAuth flows, account/user resolution
├── crud            entity CRUD (incl. attachments storage for v1)
├── analytics       derived queries, aggregates, dashboards
├── reconciler      tick loop + policies (no LLM deps)
├── engine          agent SDK loop (Anthropic + Vercel SDKs live here)
├── sandbox         podman lifecycle + exec (incl. execution metering for v1)
├── mcp             MCP servers (stdio child processes for v1)
└── billing         quota/cost (stubbed v1; real impl later)
```

### Borderline decisions, named so future-you knows where the seam will go

- **`attachments` is folded into `crud`** until storage backend diverges from primary DB.
- **`executions` is folded into `sandbox`** until non-sandbox metering arrives.
- **`events` is intentionally absent.** Explicit calls beat implicit pub/sub. `crud` writes its own audit/event rows; `analytics` queries them.
- **`engine` is split from `reconciler`.** Their dependency trees are very different (engine pulls in heavy LLM SDKs; reconciler stays light). Keeping reconciler forkable later requires this split now.
- **`billing` is stubbed.** Empty interface in `client` so wiring is in place; real impl when quota work begins.

## The cardinal rule: no cross-module imports

> A logic module may import only from `@foundry/model`, `@foundry/client`, `@foundry/db`, and its own external dependencies. It may not import from any other logic module's package.

The eight logic modules: `auth`, `billing`, `crud`, `analytics`, `sandbox`, `mcp`, `engine`, `reconciler`.

The three infrastructure modules — `model`, `client`, `db` — are freely importable by any module. They are foundations: shared types, transport plumbing, persistence handles. None of them contain domain logic.

### Persistence boundary: only `crud` and `analytics` may import `@foundry/db`

`@foundry/db` exposes drizzle schema, the `Db` connection handle, `createDatabase`, and entity row types. The per-entity query helpers (ticketGet, sessionInsert, eventInsert, executionUpdate, …) live in `@foundry/crud`. Logic modules other than crud and analytics MUST NOT import `@foundry/db` — they get persistence through callback bundles the composition root injects (e.g. `EngineDeps.crud`, `ReconcilerCrudOps`, `SandboxCrudOps`, `AuthCrudOps`).

`analytics` is a deliberate, bounded exception. Its dashboards run hand-written SQL aggregates that don't fit the per-entity helper surface; threading those through crud callbacks would invert the shape and cost legibility. The rule for analytics is **read queries only**: any analytics writes must go through crud. The manifest check enforces "non-{crud,analytics} logic modules cannot import @foundry/db" mechanically.

Exceptions:
- `server` is the composition root. It imports logic-module implementations directly to wire them and build the in-process `Client`. No other module gets this exemption.

This rule is what makes "fork out on demand" possible. The moment you let `crud` import from `analytics` directly, you've tied their lifecycles together and the seam is gone. Cross-module work flows through `client` (typed function calls) or via callback parameters supplied by the composition root — never through direct imports.

### Enforcement (mechanical, not discipline-based)

1. **TypeScript project references** — module A's `tsconfig.json` `references` does not include module B unless A actually depends on B. In practice: only `model` and `client` appear in cross-module references.
2. **ESLint `no-restricted-imports`** — error on any import from another module's package name except `@foundry/model` and `@foundry/client`.
3. **CI manifest check** — a script parses imports and confirms they match `package.json` declared dependencies. Build fails on mismatch.

If these aren't in place, the rule isn't enforced. Discipline alone won't hold past the third time someone is in a hurry.

## The `client` abstraction

Every cross-module call goes through `client`. This is the single seam that makes everything else work.

### Async always

Every client method returns a `Promise<Result<T, E>>` or an `AsyncIterable<Result<T, E>>`. Even when the in-process adapter calls a synchronous function. **No exceptions** — synchronous methods break the in-process-to-remote flip.

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

// client
type Client       = { crud: { ticketCreate(ctx: Ctx, args: TicketCreateArgs): Promise<Result<Ticket, CrudError>>; ... }, ... }
type BoundClient  = { crud: { ticketCreate(args: TicketCreateArgs): Promise<Result<Ticket, CrudError>>; ... }, ... }

function bind(client: Client, ctx: Ctx): BoundClient
```

```typescript
// boundary — bind once
async function handleCreateTicket(req: Request) {
  const ctx = ctxFromRequest(req)
  const c   = bind(client, ctx)

  const r = await c.crud.ticketCreate({ title: req.body.title })
  if (!r.ok) return errorResponse(r.error)
  await c.analytics.recordEvent('ticket.created', { id: r.value.id })
  return ok(r.value)
}
```

Boundaries (the only places `bind` is called):
- HTTP request handlers in `server`
- Reconciler tick start
- Session start
- Background job start
- Test setup

Greppable: `bind(client,` finds every "unit of work starts here" marker.

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

## One client slice per module

`client.crud.X` — that is the entire public surface of `crud`. There is no `client.crudInternal`, no `client.crudV2`, no escape hatch. If a method shouldn't be on the client, it doesn't exist on the client; it's a private function inside the module's source.

The client is the entire public surface; nothing leaks past it.

## Composition root

`server` is the only module that imports logic-module implementations directly. It:

1. Reads config from env.
2. Constructs each module's implementation, injecting direct dependencies (`db`, secrets, etc.).
3. Wires the in-process `client` adapters per module.
4. Starts the HTTP server (web UI, API, callback API for MCP servers).

Adapter choice is config-driven:

```
FOUNDRY_CRUD_TRANSPORT=in-process       # default
FOUNDRY_CRUD_TRANSPORT=http
FOUNDRY_CRUD_URL=http://crud-service.internal:7011
```

When a module is forked out, the only change in `server` is flipping its env vars. No other module touches anything.

## `model` — bottom of the dependency graph

`model` depends on nothing except optionally `zod` for runtime validation schemas. Everything else can depend on `model`.

Contents:
- **Entity types**: `Ticket`, `Session`, `Agent`, `Project`, `Account`, `Connection`, `Comment`, `Verdict`, `Activity`, `Attachment`. Domain shapes — *not* DB row shapes.
- **Error unions per module**: `CrudError`, `AnalyticsError`, etc.
- **`Ctx`, `Result<T,E>`, `ok`, `err`, `unwrap`**.
- **Primitive aliases**: `Ulid`, `Timestamp` (ISO string), branded ID types.
- **Zod schemas** (optional, for boundary validation).

Promotion rule: a type goes in `model` only when at least two modules need it. Single-module types stay internal.

## Versioning

**Single repo version. No per-module semver. No `client.v1` API surface.**

- Pre-fork-out: break the client interface freely. Type system catches consumers.
- Post-fork-out: that module's client surface is now an inter-service contract. Standard API evolution rules — additive only, no field removals, no required-arg additions, no semantic changes. Use `kind` discriminators to extend error unions safely.

Don't pay this cost until you actually fork something out.

## Cross-module callback bridges

Some logic modules need functions that live in other logic modules — for example, `auth` needs the github OAuth helpers in `mcp`, `sandbox` needs ownership checks from `crud`, `engine` needs many things from `mcp`/`sandbox`/`crud`. The cardinal rule forbids the direct import.

The pattern: each module declares a callback-interface type for what it needs (`GithubOAuthDeps`, `IsExecutionOwned`, `EngineDeps`), takes that interface as a parameter on its functions or a deps bundle on init, and the composition root in `@foundry/server` injects the actual function references at boot.

Example: `engine.runSession(db, config, deps, ...)` where `deps: EngineDeps` carries `auth.sessionJwtMint`, `mcp.foundryServer`, `sandbox.executionCreate`, `crud.encryptSecret`, etc. Engine doesn't know which logic module those came from; it sees only the function shapes it declares.

## Code-style enforcement

Module code (every package's `src/`) is held to a single rule set: top-level pure functions, depth ≤ 2, function length ≤ 20 lines after the strict-10-line target plus a small overhead for signatures and the closing brace. The 5-second-gist bar is what reviewers actually enforce; the lint cap catches drift past it.

`Result<T, E>` is the only domain-error mechanism. Modules return `Result` natively; adapters in `@foundry/client/src/adapters/` are pass-throughs. Throws are reserved for transport, cancellation, and programmer error per the rules above.

Adding an `eslint-disable` to module code is a code-review red flag. The few that exist today are non-legacy (SDK boundary types, single-aggregate SQL, composition-root callback bags, db migrations) and carry rationales that explain why the rule legitimately doesn't fit.

## Ground rules summary

1. Cross-module imports (logic modules) go through `client` and `model`. Enforced mechanically.
2. Infrastructure modules (`model`, `client`, `db`) are freely importable.
3. Async-always at the client boundary.
4. `Result<T,E>` for domain outcomes; throws for transport, cancellation, programmer error.
5. Per-module discriminated error unions, fully serializable, no `Error` objects.
6. Streams as `AsyncIterable<Result<T,E>>` — same rules, no outer Result.
7. `bind(client, ctx)` once per unit of work; no AsyncLocalStorage.
8. `server` is the only composition root. All other modules are agnostic to wiring.
9. `model` depends on nothing (except optionally zod). Promotion to `model` requires multiple consumers.
10. No `.map`, `.andThen`, `.match` on Result. Verbosity is the point.
11. No HTTP-mapped domain errors. HTTP 200 carries Result; non-200 is transport-only.
12. Top-level pure functions in module code. No classes, no closure-based factories. Closures allowed only in infrastructure (adapters, bind, compose).
13. Functions under 10 lines as default. Two levels of nesting max.
14. Predictable file layout in every module. Predictable file structure in every file. 5-second gist is the bar.

When in doubt, ask: "if I forked this module out tomorrow, would this code still work?" If the answer is "I'd need to refactor first," the rule is being violated.

The second question to ask: "can a new reader land on this file and get the gist in five seconds?" If no, the file is too clever.
