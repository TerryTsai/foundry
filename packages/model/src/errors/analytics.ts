export type AnalyticsError =
  | { kind: 'invalid_query';   reason: string }
  | { kind: 'not_found';       entity: string; id: string }
  | { kind: 'internal';        message: string }
