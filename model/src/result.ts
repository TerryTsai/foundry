// Discriminated-union Result type. See ARCHITECTURE.md for why we hand-roll
// instead of reaching for neverthrow / fp-ts.

export type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

export const ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

// Test/script-only. Never use in module code.
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(`unwrap on err: ${JSON.stringify(r.error)}`)
  return r.value
}
