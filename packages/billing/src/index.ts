// Public surface for @foundry/billing. Stubbed in v1 — every quota check
// passes with unlimited capacity. The shape is locked so reconciler and
// engine can call into it now without churn when the real
// implementation lands.

export { quotaCheck, quotaConsume } from './quota.js'
export type { QuotaResource, QuotaCheck } from './quota.js'
