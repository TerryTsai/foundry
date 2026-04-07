export interface Provider {
  id: string
  name: string
  api_key_preview: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
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

export interface Comment {
  id: string
  ticket_id: string
  author: string
  body: string
  created_at: string
}

export interface Agent {
  id: string
  project_id: string
  name: string
  model: string
  prompt: string
  max_tokens: number
  max_steps: number
  temperature: number | null
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
  started_at: string
  ended_at: string | null
}

export interface Execution {
  id: string
  session_id: string | null
  command: string
  status: 'running' | 'done' | 'failed'
  exit_code: number | null
  stdout: string | null
  stderr: string | null
  duration_ms: number | null
  timeout_ms: number
  memory_mb: number | null
  started_at: string
  ended_at: string | null
}
