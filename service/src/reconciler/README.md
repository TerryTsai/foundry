# reconciler

The only background process. Wakes every 5s, decides what should run
next, dispatches sessions. Never executes a session itself — that's
what `session/` is for.

## Flow

```
                          server.ts
                              │
                              ▼  reconcilerGlobalStart(db)
                       ┌──────────────┐
                       │ reconciler.ts│   tick every 5s
                       └──────┬───────┘
                              │  for each project, for each non-terminal ticket
                              ▼
                       ┌──────────────┐
                       │  policies/   │   ordered list, first match acts:
                       │              │     dispatchProducer
                       │              │       settleRunning
                       │              │       dispatchRecoveryProducer
                       │              │       finishWithoutVerifiers
                       │              │       dispatchVerifier
                       │              │       finishOnAllPass
                       │              │       retryAfterFail
                       └──────┬───────┘
                              │  policy decides "dispatch this session"
                              ▼  runSession(db, config, sid, agent, ticket, role)
                       ┌──────────────┐
                       │  session/    │   one session, end-to-end
                       │  session.ts  │     (see ./session/session.ts — pipeline inside)
                       └──────────────┘
                              │
                              │  fire-and-forget; runs to completion;
                              │  emits its own events
                              ▼
```

## What lives where

| Folder | Owns |
|---|---|
| `reconciler.ts` | The 5s tick loop + lifecycle (`reconcilerGlobalStart`, `reconcilerStopAll`, `shutdownDrain`). Walks active projects, builds the FIFO ticket queue, runs each ticket through the `POLICIES` list. |
| `policies/` | One file per policy. Each is a pure `(ctx) => 'acted' \| 'pass'`. Edit the `POLICIES` list in `reconciler.ts` to change reconciler behavior. `shared.ts` holds the `PolicyCtx` type, the `transition()` and `dispatchSession()` effects, and `parseVerifierIds()`. |
| `session/` | Everything that runs inside one session. Has its own internal flow (pipeline → engine → tools → sandbox). `reconciler/policies/shared.ts::dispatchSession` imports `runSession` from `session/session.ts` — that's the only edge between the two halves of this folder. |

## How session/ is organized

Same shape as the parent: one entry, supporting subfolders.

```
session/
├── session.ts         # entry — drives one session through its pipeline
├── pipeline/          # session middleware (crashSafe, bookkeeping, …, engine)
├── engines/           # LLM SDK wrappers (claude-agent-sdk, vercel-ai)
├── sandbox/           # podman runner + workspace prep
└── tools/             # built-in MCP tools (foundry, github, sandbox, browser)
```

Vendor-specific MCP tools and provider definitions live at
`../../integrations/<vendor>/` (top-level), not under session/. The
session/tools/registry pulls vendor tools from
`integrations/registry::byConnectionKind` at session start.

## Adding a policy

1. Drop a file in `policies/`.
2. Export a `Policy` named `<verbThing>` that returns `'acted' | 'pass'`.
3. Add it to `POLICIES` in `reconciler.ts` at the right position.

The list IS the interface. No central wiring.

## Adding a middleware to the session pipeline

See `session/` — same pattern, different entry point.

## Why this shape

- **One background process = one folder.** `reconciler/` is the only top-level folder that represents a process; everything else is request/response surfaces or shared primitives.
- **Reconciler owns session** because reconciler is the only thing that dispatches sessions. The directory tree mirrors the call graph.
- **Policies are first-match-wins** because each policy guards on mutually exclusive conditions (status + verdicts state). Reordering rarely changes behavior; the order documents priority for the rare overlaps (finish-on-pass runs before retry-after-fail).
