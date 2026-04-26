// Pure utility helpers shared across modules. Non-throwing — these are
// data shaping primitives, not error-handling helpers. See result.ts for
// Result types and the per-module error unions for domain errors.

export const pick = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

export const now = (): string => new Date().toISOString()

export const timestamps = (): { created_at: string; updated_at: string } => {
  const t = now()
  return { created_at: t, updated_at: t }
}

export const toInt = (s: string, fallback = 0): number => {
  const n = parseInt(s, 10)
  return isNaN(n) ? fallback : n
}

export const succeeds = async (fn: () => Promise<unknown>): Promise<boolean> => {
  try { await fn(); return true } catch { return false }
}
