// Cross-service contract for @foundry/billing. Types only — no value
// imports beyond schema.ts and @foundry/model. The aggregate Client type
// is gone; consumers (engine, reconciler, crud) import this BillingClient
// directly when they need to call billing.

import type { Ctx, Result, BillingError } from '@foundry/model'

import type { QuotaCheck, QuotaResource } from './schema.js'

export type BillingClient = {
  quotaCheck:   (ctx: Ctx, resource: QuotaResource)                  => Promise<Result<QuotaCheck, BillingError>>
  quotaConsume: (ctx: Ctx, resource: QuotaResource, amount: number)  => Promise<Result<QuotaCheck, BillingError>>
}
