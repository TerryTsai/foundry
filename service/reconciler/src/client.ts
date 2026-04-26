// Cross-service contract for @foundry/reconciler. Empty by design — the
// reconciler is started/stopped at boot by the composition root and walks
// active projects on its own tick. There are no per-request routes that
// call into it through the typed client.
//
// If a future use case needs to nudge the reconciler (force-tick, drain),
// add it here as a Result-shaped method and wire the service.

export type ReconcilerClient = Record<string, never>
