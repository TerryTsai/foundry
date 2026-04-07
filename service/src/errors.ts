export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

export const ok         = <T>(data: T): Result<T>                    => ({ ok: true, data })
export const fail       = <T>(status: number, error: string): Result<T> => ({ ok: false, status, error })
export const notFound   = <T>(msg?: string): Result<T>               => fail(404, msg ?? 'not found')
export const conflict   = <T>(msg: string): Result<T>                => fail(409, msg)
export const badRequest = <T>(msg: string): Result<T>                => fail(400, msg)
