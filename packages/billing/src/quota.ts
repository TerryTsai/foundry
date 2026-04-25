import type { Ctx, Result, BillingError } from '@foundry/model'
import { ok } from '@foundry/model'

// Quota is unlimited until real billing work begins. The shape is here
// so reconciler / engine / crud can call it now and silently get green
// lights; later the real implementation wires up to the billing
// backend.

export type QuotaResource = 'sessions_concurrent' | 'sessions_monthly' | 'storage_mb' | 'tokens_monthly'

export type QuotaCheck = {
  allowed: boolean
  resource: QuotaResource
  limit: number   // Number.POSITIVE_INFINITY when unlimited
  used:  number
}

export const quotaCheck = async (
  _ctx: Ctx, _resource: QuotaResource,
): Promise<Result<QuotaCheck, BillingError>> =>
  ok({ allowed: true, resource: _resource, limit: Number.POSITIVE_INFINITY, used: 0 })

export const quotaConsume = async (
  _ctx: Ctx, _resource: QuotaResource, _amount: number,
): Promise<Result<QuotaCheck, BillingError>> =>
  ok({ allowed: true, resource: _resource, limit: Number.POSITIVE_INFINITY, used: 0 })
