export type BillingError =
  | { kind: 'quota_exceeded';   resource: string; limit: number; used: number }
  | { kind: 'not_configured' }
  | { kind: 'internal';         message: string }
