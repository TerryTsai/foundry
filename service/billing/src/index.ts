// Public surface for @foundry/billing. Stubbed in v1 — every quota check
// passes with unlimited capacity. The shape is locked so reconciler and
// engine can call into it now without churn when the real implementation
// lands.

export { createBillingService } from './service.js'
export type { BillingClient } from './client.js'
export type { QuotaResource, QuotaCheck } from './schema.js'

// Raw exports remain during the @foundry/client → per-service migration.
// Removed at cutover when the uber-client package is deleted.
export { quotaCheck, quotaConsume } from './quota.js'
