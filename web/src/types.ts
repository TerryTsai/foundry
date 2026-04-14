export interface Account {
  id: string
  login: string
  name: string | null
  avatar_url: string | null
  description: string
}

export interface Connection {
  id: string
  account_id: string
  kind: string
  name: string
  config: string              // JSON blob
  api_key_preview: string | null
  created_at: string
  updated_at: string
}

export interface CredentialField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea'
  placeholder?: string
  options?: string[]
  required?: boolean
  help?: string
}

export interface ProviderMetadata {
  kind: string
  name: string
  credentials: CredentialField[]
  has_model: boolean
  tool_names: string[]
}

export interface Project {
  id: string
  owner_id: string
  name: string
  repo: string
  status: 'active' | 'archived'
  max_agents: number
  created_at: string
  updated_at: string
}

export interface Ticket {
  id: string
  project_id: string
  agent_id: string | null
  title: string
  description: string
  status: 'open' | 'claimed' | 'done' | 'failed' | 'blocked' | 'reopened'
  priority: number
  parent_id: string | null
  blocked_by: string | null
  created_by: string
  created_at: string
  updated_at: string
  claimed_at: string | null
}

export interface Tag {
  id: string
  ticket_id: string
  tag: string
  created_at: string
}

export interface AnalyticsSummary {
  total_cost_usd: number
  total_sessions: number
  sessions_done: number
  sessions_failed: number
  sessions_running: number
  total_tokens_in: number
  total_tokens_out: number
  total_duration_ms: number
  total_exec_count: number
  total_cpu_ms: number
  total_net_bytes: number
  peak_memory_mb: number | null
  total_tickets: number
  tickets_open: number
  tickets_done: number
  tickets_failed: number
}

export interface AnalyticsDay {
  date: string
  sessions: number
  sessions_done: number
  sessions_failed: number
  cost_usd: number
  tokens_in: number
  tokens_out: number
  tickets_created: number
  tickets_completed: number
}

export interface AnalyticsAgent {
  agent_id: string
  agent_name: string
  sessions: number
  sessions_done: number
  sessions_failed: number
  cost_usd: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
  avg_duration_ms: number
  avg_cost_usd: number
}

export interface AnalyticsTag {
  tag: string
  tickets: number
  tickets_done: number
  tickets_failed: number
  sessions: number
  cost_usd: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
}

export interface Analytics {
  summary: AnalyticsSummary
  daily: AnalyticsDay[]
  agents: AnalyticsAgent[]
  tags: AnalyticsTag[]
}

export interface McpToolInfo {
  name: string
  description: string
}

export type McpCategory = 'core' | 'code' | 'infra' | 'data' | 'product' | 'growth'

export interface McpServerInfo {
  id: string
  name: string
  description: string
  category: McpCategory
  tools: McpToolInfo[]
}

// null or {} = all tools on all servers (no restriction)
// key present with '*' = all tools from that server
// key present with string[] = specific tools from that server
// key absent = server not attached
export type McpToolSelection = Record<string, '*' | string[]>

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
  account_id: string
  connection_id: string
  name: string
  description: string
  model: string
  max_tokens: number
  max_steps: number
  temperature: number | null
  reasoning_budget: number | null
  tools: string | null
  superseded_at: string | null
  created_at: string
}

export interface Session {
  id: string
  ticket_id: string
  agent_id: string
  agent_name: string | null
  status: 'running' | 'done' | 'failed'
  model: string                        // derived from agent.model on read
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
  tool_use_id: string | null
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

// One row per content block (text / thinking / tool_use / reconcile /
// prompt). Grouped by turn_id when rendering to reconstruct a model
// turn. Kinds:
//   'prompt'    — founder's initial trigger
//   'thought'   — extended-thinking block
//   'said'      — assistant text block
//   'tool_call' — tool-use block; execution_id links to the correlated
//                 sandbox execution
//   'reconcile' — token reconciliation against the SDK's modelUsage
export interface Activity {
  id: string
  session_id: string
  turn_id: string | null
  kind: 'prompt' | 'thought' | 'said' | 'tool_call' | 'reconcile'
  order_index: number
  payload: string
  tool_use_id: string | null
  execution_id: string | null
  tokens_in: number | null
  tokens: number | null
  created_at: string
}
