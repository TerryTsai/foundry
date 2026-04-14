import { notFound, conflict } from './errors.js'

export const require = <T>(row: T | undefined, msg?: string): T => {
  if (!row) throw notFound(msg)
  return row
}

export const assertStatus = <T extends { status: string }>(row: T, expected: string | string[], msg?: string): T => {
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.includes(row.status)) throw conflict(msg ?? `cannot transition from '${row.status}'`)
  return row
}

export const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const pick = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

export const now = () => new Date().toISOString()

export const ts = (): { created_at: string; updated_at: string } => {
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
