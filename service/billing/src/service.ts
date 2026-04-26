// Wiring for @foundry/billing. Returns a BillingClient backed by the
// module's pure functions — no runtime state needed for the v1 stub.
// Real implementation later wires here without changing the contract.

import { quotaCheck, quotaConsume } from './quota.js'
import type { BillingClient } from './client.js'

export const createBillingService = (): BillingClient => ({
  quotaCheck:   (ctx, resource)         => quotaCheck(ctx, resource),
  quotaConsume: (ctx, resource, amount) => quotaConsume(ctx, resource, amount),
})
