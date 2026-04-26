// In-process adapter for the billing slice. The underlying module already
// returns Result-native shapes — this adapter is a one-line passthrough
// per method. No try/catch, no AppError translation needed.

import * as billing from '@foundry/billing'

import type { BillingSlice } from '../slices/billing.js'

export const createBillingAdapter = (_deps: Record<string, never> = {}): BillingSlice => ({
  quotaCheck:   (ctx, resource)         => billing.quotaCheck(ctx, resource),
  quotaConsume: (ctx, resource, amount) => billing.quotaConsume(ctx, resource, amount),
})
