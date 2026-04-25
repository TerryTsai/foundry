// Adapter helpers. Each module's in-process adapter wraps throwing module
// internals (legacy AppError pattern) in try/catch and converts the throw
// to a Result.err with a per-module-typed kind discriminator.
//
// Unexpected errors (anything that isn't an AppError) propagate — those
// are programmer errors / transport failures and shouldn't be silently
// stuffed into a domain Result.

import type { AppError, Result } from '@foundry/model'
import { isAppError, ok, err } from '@foundry/model'

export const wrap = async <T, E>(
  fn: () => T | Promise<T>,
  toErr: (e: AppError) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await fn())
  } catch (e) {
    if (isAppError(e)) return err(toErr(e))
    throw e
  }
}
