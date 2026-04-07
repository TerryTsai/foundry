import type { Response } from 'express'
import type { ZodType } from 'zod'
import { AppError, badRequest } from './errors.js'

export const parse = <T>(schema: ZodType<T>) => (data: unknown): T => {
  const result = schema.safeParse(data)
  if (!result.success) throw badRequest(JSON.stringify(result.error.flatten()))
  return result.data
}

export const send = (res: Response, status = 200) => <T>(data: T): void => {
  res.status(status).json(data)
}

export const sendText = (res: Response) => (data: string): void => {
  res.type('text/plain').send(data)
}

export const fail = (res: Response) => (err: unknown): void => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message })
  } else {
    console.error(err)
    res.status(500).json({ error: 'internal error' })
  }
}
