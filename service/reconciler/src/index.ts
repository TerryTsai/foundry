// Public surface for @foundry/reconciler.
//
// service.ts owns the lifecycle (tick + drain handles); the
// cross-service ReconcilerClient is empty since no other service calls
// reconciler today. Policies live as pure functions and are composed
// at server boot via createReconcilerService.

export { createReconcilerService } from './service.js'
export type { ReconcilerService } from './service.js'
export type { ReconcilerClient } from './client.js'

// Policies — server composes these into the ordered list passed to
// createReconcilerService. Reordering or omitting changes reconciler
// behavior; that decision is wiring, not logic.
export { dispatchProducer }         from './policies/dispatch-producer.js'
export { settleRunning }            from './policies/settle-running.js'
export { dispatchRecoveryProducer } from './policies/dispatch-recovery-producer.js'
export { finishWithoutVerifiers }   from './policies/finish-without-verifiers.js'
export { dispatchVerifier }         from './policies/dispatch-verifier.js'
export { finishOnAllPass }          from './policies/finish-on-all-pass.js'
export { retryAfterFail }           from './policies/retry-after-fail.js'

export type { Policy, PolicyCtx } from './schema.js'
