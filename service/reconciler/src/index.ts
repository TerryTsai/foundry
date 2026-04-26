// Public surface for @foundry/reconciler.
//
// Lifecycle (interval start/stop, on-demand trigger callbacks) and the
// policy ordering both belong to the composition root (@foundry/server).
// Reconciler exposes only pure functions and the policy implementations
// the server composes into a list.

export { reconcilerTick, shutdownDrain } from './reconciler.js'

// Policies — server composes these into the ordered list passed to
// reconcilerTick. Reordering or omitting changes reconciler behavior;
// that decision is wiring, not logic.
export { dispatchProducer }         from './policies/dispatch-producer.js'
export { settleRunning }            from './policies/settle-running.js'
export { dispatchRecoveryProducer } from './policies/dispatch-recovery-producer.js'
export { finishWithoutVerifiers }   from './policies/finish-without-verifiers.js'
export { dispatchVerifier }         from './policies/dispatch-verifier.js'
export { finishOnAllPass }          from './policies/finish-on-all-pass.js'
export { retryAfterFail }           from './policies/retry-after-fail.js'

export type {
  ReconcilerDeps,
  ReconcilerConfig,
  ReconcilerCrudOps,
  EngineDeps,
  RunSessionFn,
  Policy,
  PolicyCtx,
} from './schema.js'
