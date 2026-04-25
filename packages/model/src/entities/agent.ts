import type { AccountId, AgentId, Timestamp, Ulid } from '../primitives.js'

// Immutable: edit = insert new row, set superseded_at on prior.
// A partial unique index on (account_id, name) WHERE superseded_at IS NULL
// keeps "current by name" honest without blocking history.
export type Agent = {
  id:               AgentId
  account_id:       AccountId
  connection_id:    Ulid
  name:             string
  description:      string
  model:            string
  max_tokens:       number
  max_steps:        number
  temperature:      number | null
  reasoning_budget: number | null
  tools:            string | null   // JSON: McpToolSelection
  verifiers:        string | null   // JSON: agent_id[]
  superseded_at:    Timestamp | null
  created_at:       Timestamp
}
