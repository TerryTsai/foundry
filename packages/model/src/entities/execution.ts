import type { SessionId, Timestamp, Ulid } from '../primitives.js'

export type ExecutionStatus = 'running' | 'finished' | 'failed' | 'cancelled'

export type Execution = {
  id:              Ulid
  session_id:      SessionId | null
  // Joined with activity.tool_use_id; both rows carry it independently
  // because the SDK and MCP-execution paths can race.
  tool_use_id:     string | null
  tool_name:       string | null
  tool_input:      string | null
  command:         string
  status:          ExecutionStatus
  exit_code:       number | null
  exit_signal:     string | null
  stdout:          string | null
  stderr:          string | null
  duration_ms:     number | null
  timeout_ms:      number
  memory_mb:       number | null
  peak_memory_mb:  number | null
  cpu_ms:          number | null
  net_rx_bytes:    number | null
  net_tx_bytes:    number | null
  started_at:      Timestamp
  ended_at:        Timestamp | null
}
