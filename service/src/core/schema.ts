// Re-export shim. The real schema and per-entity helpers live in
// @foundry/db. This file stays during the migration window so existing
// `import * as schema from '../core/schema.js'` keeps working unchanged.
// Removed in Phase 8 once nothing references it.

export * from '@foundry/db'
