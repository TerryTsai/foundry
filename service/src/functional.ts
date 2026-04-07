// ── Error Guards ──

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const notFound   = (msg = 'not found')  => new AppError(404, msg)
export const conflict   = (msg: string)        => new AppError(409, msg)
export const badRequest = (msg: string)        => new AppError(400, msg)

// ── Assertions ──

export const require = <T>(row: T | undefined, msg?: string): T => {
  if (!row) throw notFound(msg)
  return row
}

export const assertStatus = <T extends { status: string }>(row: T, expected: string, msg?: string): T => {
  if (row.status !== expected) throw conflict(msg ?? `cannot transition from '${row.status}'`)
  return row
}

// ── Transforms ──

export const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const pick = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

export const now = () => new Date().toISOString()
