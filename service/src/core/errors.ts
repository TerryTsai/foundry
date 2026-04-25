// Re-export shim. Real implementation lives in @foundry/model (legacy
// section). Removed in Phase 8 once nothing references it.

export {
  appError, isAppError,
  notFound, conflict, badRequest, unauthorized, forbidden,
} from '@foundry/model'
export type { AppError } from '@foundry/model'
