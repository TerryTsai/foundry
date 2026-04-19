# agent-runtime

Everything that runs when a session is dispatched. The `reconciler/`
package decides *what* to run; this package runs it.

## Flow

```
                          reconciler.ts            (../reconciler)
                                │
                                ▼  runSession(db, config, sid, agent, ticket, role)
                          ┌──────────────┐
                          │  session.ts  │   build SessionContext, mint sandbox JWT
                          └──────┬───────┘
                                 │
                       ┌─────────▼─────────┐
                       │  pipeline/ stack  │   onion middleware, outermost first:
                       │                   │     crashSafe → bookkeeping → activityBackfill
                       │                   │       → ticketFailOnCrash | syntheticFailVerdict
                       │                   │       → workspace → systemPrompt
                       │                   │       → openingPrompt → cooperativeCancel
                       │                   │       → engine  (innermost — picks the SDK
                       │                   │                  and runs it)
                       └─────────┬─────────┘
                                 │
                          ┌──────▼──────┐
                          │  engines/   │   anthropic.ts (Claude Agent SDK) or
                          │             │   vercel.ts (Vercel AI SDK) drives the model
                          └──────┬──────┘
                          model emits tool_use
                                 │
                          ┌──────▼──────┐
                          │   tools/    │   typed MCP tools (foundry, github, sandbox,
                          │             │   browser, cloudflare, aws, …)
                          └──────┬──────┘
                          tools that exec call runCommand
                                 │
                          ┌──────▼──────┐
                          │  sandbox/   │   spawn podman, capture stats, cleanup
                          └─────────────┘

                          providers/   defines which 3rd-party services exist;
                                       tools/ looks them up to dispatch calls
```

## What lives where

| Folder | Owns |
|---|---|
| `session.ts` | Entrypoint. Builds context, mints the sandbox JWT, picks producer-vs-verifier stack, calls it. |
| `pipeline/` | Session middleware (crash-safe, bookkeeping, cancel, etc.). `compose.ts` is the wrap utility. The order in `session.ts` matches the diagram. |
| `engines/` | Implementations that drive the LLM through its agent loop. One per SDK. `model-factory.ts` builds Vercel AI model objects from connections. |
| `tools/` | MCP tool implementations the LLM can invoke. `foundry.ts` curls back into `/crud/*`. `sandbox.ts` runs commands. `github.ts` does git ops. Provider-specific tools (cloudflare, aws, …) inject creds via `secretFiles`. |
| `providers/` | Provider definitions (kind, name, credentials schema). `tools/` looks these up to dispatch calls; the user-facing CRUD in `../connections/` stores the actual API tokens. |
| `sandbox/` | Podman runner (`podman.ts`) and per-execution workspace prep (`workspace.ts`). |

## Dependencies

- `../core/*` — db, schema, config, errors, util
- `../auth/session-jwt.ts` — mint/verify the sb_ JWT
- `../connections/secrets-crypto.ts` — decrypt connection.secrets at use
- `../tickets/service.ts`, `../sessions/service.ts`, etc. — read/write user-facing resources (foundry tools curl through HTTP, but a few middleware paths import directly)

## Adding a middleware

1. Drop a file in `pipeline/`.
2. Export `withYourThing: Middleware`.
3. Add it to the `PRODUCER` and/or `VERIFIER` list in `session.ts`, in the right wrap position.

That's it. Reading `session.ts` should always tell you exactly what wraps a session and in what order.

## Adding an engine

1. Drop a file in `engines/`.
2. Export a function that takes a `SessionContext` and returns a `LoopResult`.
3. Edit `invokeEngine` in `session.ts` to dispatch to it for the right connection kind.

## Adding a tool

1. Drop a file in `tools/`.
2. Export `tools: ToolDef[]` and `info: McpServerInfo`.
3. Register in `tools/registry.ts`.
