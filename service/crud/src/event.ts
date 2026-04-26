// Event log writes/reads. Entity-agnostic — callers pass entity_type.
// Used by reconciler (state transitions), engine (session lifecycle),
// and route handlers (initial ticket events).

import { type Db } from '@foundry/db'
import type { Event } from '@foundry/db'
import * as database from './repo.js'
import type { EventCreateInput } from './schema.js'

export function eventCreate(db: Db, input: EventCreateInput): Event {
  return database.eventInsert(db, input)
}

export function eventByEntity(db: Db, entityType: string, entityId: string): Event[] {
  return database.eventByEntity(db, entityType, entityId)
}

export function eventLatest(db: Db, entityType: string, entityId: string): Event | undefined {
  return database.eventLatest(db, entityType, entityId)
}
