export type TaskStatus = 'queued' | 'working' | 'needs_you' | 'paused' | 'done'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export type Task = {
  id: string
  path: string
  title: string
  description: string
  guidance: string[]
  current: string[]
  next: string
  status: TaskStatus
  priority: Priority
  updated: string
  nextEligibleAt?: string
}

export type Project = {
  id: string
  owner: string
  repo: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
  config: {
    name?: string
    enabled: boolean
    priority: Priority
    harness: { type: string; command?: string }
    runtime: { type: 'podman' | 'docker'; image?: string }
  }
  tasks: Task[]
}

export type Workspace = {
  projects: Project[]
  settings: { frequency: 'manual' | '15m' | '30m' | '1h' | '4h'; paused: boolean }
  worker: {
    busy: boolean
    startedAt: string | null
    projectId: string | null
    taskId: string | null
    lastCycleAt: string | null
    lastMessage: string | null
  }
}

export type Repository = {
  full_name: string
  name: string
  owner: { login: string }
  default_branch: string
  private: boolean
  html_url: string
  foundryEnabled: boolean
}

export type GithubCommit = {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } }
}
