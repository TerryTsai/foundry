// Per-call context. Bound once at a unit-of-work boundary; carried through
// every client call. Must serialize across process boundaries (so HTTP
// adapters can carry it as headers). The AbortSignal does not serialize,
// but cancellation propagates via fetch abort instead.

export type Ctx = {
  accountId: string         // 'system' for bootstrap
  traceId:   string         // request/work-unit correlation
  deadline?: number         // epoch ms; undefined = no deadline
  signal:    AbortSignal    // cancellation
  now:       () => number   // injectable time source
}

// Build a Ctx for tests or bootstrap code. Provides safe defaults.
export const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
  accountId: 'system',
  traceId:   `t_${Math.random().toString(36).slice(2, 10)}`,
  signal:    new AbortController().signal,
  now:       () => Date.now(),
  ...overrides,
})
