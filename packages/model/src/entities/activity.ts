import type { SessionId, Timestamp, Ulid } from '../primitives.js'

// Flat event log. One row per block the model emitted, one row per
// execution correlation. Group by turn_id to recover a turn.
//
// Kinds:
//   prompt    — founder's initial ticket input
//   thought   — assistant 'thinking' block
//   said      — assistant 'text' block
//   tool_call — assistant 'tool_use' block; execution_id required
//   reconcile — system modelUsage delta at session close
export type ActivityKind =
  | 'prompt'
  | 'thought'
  | 'said'
  | 'tool_call'
  | 'reconcile'

// Tokens: full turn's totals sit on the FIRST activity of each turn
// (lowest order_index for a turn_id). Others carry NULL for tokens.
export type Activity = {
  id:           Ulid
  session_id:   SessionId
  turn_id:      string | null
  kind:         ActivityKind
  order_index:  number
  payload:      string   // JSON, shape per kind
  tool_use_id:  string | null
  execution_id: Ulid | null
  tokens_in:    number | null
  tokens:       number | null
  created_at:   Timestamp
}
