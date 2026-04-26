# @foundry/engine

The agent SDK loop. Owns the session driver (`runSession`), the middleware pipeline that wraps every session (crash-safe, bookkeeping, workspace, system/opening prompt, cooperative cancel, ticket-fail-on-crash, synthetic-fail-verdict), and the two engine backends — the Claude Agent SDK loop for `anthropic-subscription` connections and the Vercel AI SDK loop for everything else. Cross-module dependencies (auth JWT mint, MCP tool servers and helpers, sandbox lifecycle, crud secret crypto + attachments) are passed in as a single `EngineDeps` object by the composition root; the engine never imports another logic module. Does NOT own the reconciler tick, policy decisions, MCP tool definitions, sandbox podman lifecycle, or session/ticket CRUD.

See /ARCHITECTURE.md for the conventions every module follows.
