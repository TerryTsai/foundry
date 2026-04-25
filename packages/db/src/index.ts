// Public surface for @foundry/db. Drizzle schema tables, entity types,
// connection factory, and per-entity query helpers. Infrastructure
// module — direct imports allowed across packages.
//
// Names don't collide between schema and db.ts: schema exports nouns
// (account, ticket, agent), db.ts exports verbs (ticketAll, ticketGet,
// eventInsert) and createDatabase + the Db type.

export * from './schema.js'
export * from './db.js'
