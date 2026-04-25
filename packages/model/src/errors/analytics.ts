export type AnalyticsError =
  | { kind: 'invalid_query'; reason: string }
  | { kind: 'internal';      message: string }
