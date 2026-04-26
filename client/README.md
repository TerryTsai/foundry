# @foundry/client

The typed cross-module surface. Every logic module exposes its public API as a slice on the `Client` type; `bind(client, ctx)` produces a `BoundClient` with ctx pre-applied so call sites stay clean.

This module owns: the `Client` / `BoundClient` types, `bind()`, the in-process adapter factory, and (in Phase 5) the HTTP adapter factory. It does NOT own logic — every method on every slice is implemented in the relevant logic module and wired through an adapter.

See `/ARCHITECTURE.md` for the rules and conventions.
