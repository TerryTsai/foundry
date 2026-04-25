// Auth module domain errors. Throws (transport, programmer error) are not
// represented here; they propagate as exceptions.

export type AuthError =
  | { kind: 'invalid_token';     reason: string }
  | { kind: 'expired_session' }
  | { kind: 'not_authenticated' }
  | { kind: 'rate_limited';      retry_after_ms: number }
  | { kind: 'internal';          message: string }
