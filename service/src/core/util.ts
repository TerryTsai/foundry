// Re-export shim. Real implementation lives in @foundry/model (legacy
// section). Removed in Phase 8 once nothing references it.

export {
  mustExist, assertStatus,
  pick, now, timestamps, toInt, succeeds,
} from '@foundry/model'
