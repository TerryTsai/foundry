import type { AgentId, ProjectId, Timestamp, TicketId } from '../primitives.js'

// State machine:
//   created → waiting → running → finished | failed | cancelled
// "blocked" is derived: dispatchable iff status='created' AND
// (depends_on IS NULL OR depends_on.status='finished').
export type TicketStatus =
  | 'created'
  | 'waiting'
  | 'running'
  | 'finished'
  | 'failed'
  | 'cancelled'

export type Ticket = {
  id:          TicketId
  project_id:  ProjectId
  agent_id:    AgentId | null
  title:       string
  description: string
  status:      TicketStatus
  depends_on:  TicketId | null
  tags:        string   // JSON array of strings
  created_by:  string
  created_at:  Timestamp
  updated_at:  Timestamp
}
