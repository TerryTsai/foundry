// Tagged-object errors. No class. `appError` produces a plain Error
// with a status + _tag so `isAppError` can narrow, and throw/catch
// interop stays identical to a subclass.

export type AppError = Error & { status: number; _tag: 'AppError' }

export const appError = (status: number, message: string): AppError => {
  const e = new Error(message) as AppError
  e.status = status
  e._tag   = 'AppError'
  return e
}

export const isAppError = (e: unknown): e is AppError =>
  !!e && typeof e === 'object' && (e as { _tag?: unknown })._tag === 'AppError'

export const notFound   = (msg = 'not found') => appError(404, msg)
export const conflict   = (msg: string)       => appError(409, msg)
export const badRequest = (msg: string)       => appError(400, msg)
export const unauthorized = (msg = 'unauthorized') => appError(401, msg)
export const forbidden    = (msg = 'forbidden')    => appError(403, msg)
