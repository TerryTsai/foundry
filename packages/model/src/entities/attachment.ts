import type { Timestamp, TicketId, Ulid } from '../primitives.js'

// Exactly one of ticket_id or comment_id is set — never both.
// `bytes` is omitted from the domain type; load separately when needed
// to avoid pulling blobs in normal SELECTs.
export type Attachment = {
  id:         Ulid
  ticket_id:  TicketId | null
  comment_id: Ulid | null
  name:       string
  mime:       string
  size:       number
  created_by: string
  created_at: Timestamp
}
