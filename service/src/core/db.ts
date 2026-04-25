// Re-export shim. The real implementation lives in @foundry/db. This file
// stays during the migration window so existing service imports
// (`../core/db.js`) keep working without churn. Each module migration in
// Phase 4 replaces its own imports with `@foundry/db` directly; the shim
// is removed in Phase 8 once nothing references it.

export * from '@foundry/db'
