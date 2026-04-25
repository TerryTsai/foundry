# @foundry/reconciler

The only background process. Owns the 5-second tick loop (`reconcilerGlobalStart`, `reconcilerStopAll`, `reconcilerTick`, `shutdownDrain`) and the ordered list of policies that decide what should run next for each non-terminal ticket — `dispatchProducer`, `settleRunning`, `dispatchRecoveryProducer`, `finishWithoutVerifiers`, `dispatchVerifier`, `finishOnAllPass`, `retryAfterFail`. Cross-module dependencies (`agentList` from crud, `runSession` + `engineDeps` from engine) arrive as a single `ReconcilerDeps` bundle constructed at the composition root; the reconciler never imports another logic module. Does NOT own session execution (that's `@foundry/engine`), MCP tool definitions, the sandbox lifecycle, or entity CRUD.

See /ARCHITECTURE.md for the conventions every module follows.
