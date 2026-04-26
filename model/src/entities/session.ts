import type { AgentId, SessionId, Timestamp, TicketId } from '../primitives.js'

export type SessionStatus = 'running' | 'finished' | 'failed' | 'cancelled'

export type Session = {
  id:             SessionId
  ticket_id:      TicketId
  agent_id:       AgentId
  status:         SessionStatus
  error:          string | null
  cost_usd:       number | null
  duration_ms:    number | null
  // Verifier-only. Producer sessions leave these null. One verdict per
  // verifier session — written by verdictReport tool or synthetic-fail.
  verdict_pass:   boolean | null
  verdict_reason: string | null
  started_at:     Timestamp
  ended_at:       Timestamp | null
}
