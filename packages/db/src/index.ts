// Public surface for @foundry/db. Slim by design: drizzle schema tables,
// drizzle-inferred entity types, the Db handle type, and createDatabase.
//
// Per-entity write helpers live in @foundry/crud. Analytics keeps a
// narrow set of read-only query helpers here (queries.ts) — see
// ARCHITECTURE.md for the exception. Every other logic module accesses
// persistence through callbacks the composition root injects.

export * from './schema.js'
export { createDatabase, type Db } from './db.js'
export {
  projectAll, ticketGet, agentGet, executionBySession,
  sessionGetAggregated, sessionAggregateAll,
} from './queries.js'
