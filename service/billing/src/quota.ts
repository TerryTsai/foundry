import type { Ctx, Result, BillingError } from '@foundry/model'
import { ok } from '@foundry/model'

import type { QuotaCheck, QuotaResource } from './schema.js'

// Quota is unlimited until real billing work begins. The shape is here
// so reconciler / engine / crud can call it now and silently get green
// lights; later the real implementation wires up to the billing backend.

export async function quotaCheck(
  _ctx: Ctx, resource: QuotaResource,
): Promise<Result<QuotaCheck, BillingError>> {
  return ok({ allowed: true, resource, limit: Number.POSITIVE_INFINITY, used: 0 })
}

export async function quotaConsume(
  _ctx: Ctx, resource: QuotaResource, _amount: number,
): Promise<Result<QuotaCheck, BillingError>> {
  return ok({ allowed: true, resource, limit: Number.POSITIVE_INFINITY, used: 0 })
}
