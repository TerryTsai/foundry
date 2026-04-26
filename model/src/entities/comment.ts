import type { SessionId, Timestamp, TicketId, Ulid } from '../primitives.js'

export type Comment = {
  id:         Ulid
  ticket_id:  TicketId
  session_id: SessionId | null
  author:     string
  body:       string
  created_at: Timestamp
}
