export interface Project {
  id: string
  name: string
  slug: string
  status: 'active' | 'paused'
  workspace: string
  schedule_interval: number
  concurrency_limit: number
  created_at: string
}

export interface Ticket {
  id: string
  project_id: string
  title: string
  body: string
  agent: string
  status: 'open' | 'claimed' | 'done' | 'failed' | 'blocked'
  parent_id: string | null
  notes: string | null
  created_by: string
  created_at: string
  claimed_at: string | null
}

export interface AgentDef {
  id: string
  project_id: string
  name: string
  prompt: string
  image: string
  env: string   // JSON string: string[]
  created_at: string
}

export interface AgentSession {
  id: string
  ticket_id: string
  agent_def_id: string
  status: 'running' | 'done' | 'failed'
  started_at: string
  ended_at: string | null
}
