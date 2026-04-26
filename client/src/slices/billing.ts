// Cross-module surface for @foundry/billing. The module already returns
// Result-native shapes (quotaCheck/quotaConsume return Promise<Result<…>>),
// so the slice just declares the signatures. The adapter is a thin
// re-export.

import type { Ctx, Result, BillingError } from '@foundry/model'

export type QuotaResource = 'sessions_concurrent' | 'sessions_monthly' | 'storage_mb' | 'tokens_monthly'

export type QuotaCheck = {
  allowed:  boolean
  resource: QuotaResource
  limit:    number
  used:     number
}

export type BillingSlice = {
  quotaCheck:   (ctx: Ctx, resource: QuotaResource)                   => Promise<Result<QuotaCheck, BillingError>>
  quotaConsume: (ctx: Ctx, resource: QuotaResource, amount: number)   => Promise<Result<QuotaCheck, BillingError>>
}
