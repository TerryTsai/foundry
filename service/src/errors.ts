export class AppError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const notFound   = (msg = 'not found')  => new AppError(404, msg)
export const conflict   = (msg: string)        => new AppError(409, msg)
export const badRequest = (msg: string)        => new AppError(400, msg)
