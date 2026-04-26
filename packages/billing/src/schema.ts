// Shapes for @foundry/billing. Types only; quota is unlimited until
// real billing work begins.

export type QuotaResource = 'sessions_concurrent' | 'sessions_monthly' | 'storage_mb' | 'tokens_monthly'

export type QuotaCheck = {
  allowed:  boolean
  resource: QuotaResource
  limit:    number   // Number.POSITIVE_INFINITY when unlimited
  used:     number
}
