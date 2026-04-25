import type { Timestamp, Ulid } from '../primitives.js'

// Append-only audit log for state transitions across all entities.
export type Event = {
  id:           Ulid
  entity_type:  string         // ticket | session | execution
  entity_id:    Ulid
  kind:         string         // created | status_changed | …
  data:         string         // JSON payload
  caused_by:    string         // founder | agent | reconciler | runtime
  caused_by_id: string | null
  created_at:   Timestamp
}
