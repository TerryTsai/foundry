export interface Account {
  id: string
  login: string
  name: string | null
  avatar_url: string | null
}

export interface Connection {
  id: string
  project_id: string | null
  kind: string
  name: string
  config: string              // JSON blob
  api_key_preview: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  repo: string
  status: 'active' | 'archived'
  schedule_interval: number
  concurrency_limit: number
  created_at: string
  updated_at: string
}

export interface Ticket {
  id: string
  project_id: string
  agent_id: string | null
  title: string
  body: string
  status: 'open' | 'claimed' | 'done' | 'failed' | 'blocked'
  priority: number
  parent_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  claimed_at: string | null
}

export interface UsageRollup {
  session_count: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
  step_count: number
  tool_calls: number
  exec_count: number
  cpu_ms: number
  peak_memory_mb: number | null
  net_bytes: number
}

export interface Comment {
  id: string
  ticket_id: string
  session_id: string | null
  author: string
  body: string
  created_at: string
}

export interface Agent {
  id: string
  project_id: string
  connection_id: string
  name: string
  model: string
  prompt: string
  max_tokens: number
  max_steps: number
  temperature: number | null
  reasoning_budget: number | null
  tools: string | null
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  ticket_id: string
  agent_id: string
  agent_name: string | null
  status: 'running' | 'done' | 'failed'
  model: string
  error: string | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  duration_ms: number | null
  step_count: number | null
  tool_calls: number | null
  finish_reason: string | null
  system_prompt: string | null
  started_at: string
  ended_at: string | null
}

export interface Execution {
  id: string
  session_id: string | null
  tool_name: string | null
  tool_input: string | null
  command: string
  status: 'running' | 'done' | 'failed'
  exit_code: number | null
  exit_signal: string | null
  stdout: string | null
  stderr: string | null
  duration_ms: number | null
  timeout_ms: number
  memory_mb: number | null
  peak_memory_mb: number | null
  cpu_ms: number | null
  net_rx_bytes: number | null
  net_tx_bytes: number | null
  started_at: string
  ended_at: string | null
}

export interface Message {
  id: string
  session_id: string
  role: string
  content: string
  tokens: number | null
  tokens_in: number | null
  created_at: string
}
