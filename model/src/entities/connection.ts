import type { AccountId, Timestamp, Ulid } from '../primitives.js'

export type Connection = {
  id:         Ulid
  account_id: AccountId
  kind:       string
  name:       string
  config:     string   // JSON string
  secrets:    string   // JSON string, encrypted
  created_at: Timestamp
  updated_at: Timestamp
}
