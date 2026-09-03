export const taskStatuses = ['queued', 'working', 'needs_you', 'paused', 'done'] as const
export type TaskStatus = typeof taskStatuses[number]
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export type Task = {
  id: string
  path: string
  sha: string
  title: string
  description: string
  guidance: string[]
  current: string[]
  next: string
  status: TaskStatus
  priority: Priority
  updated: string
  nextEligibleAt?: string
  nextTask?: string
}

export type ProjectConfig = {
  name?: string
  enabled: boolean
  priority: Priority
  harness: { type: string; command?: string }
  runtime: { type: 'podman' | 'docker'; image?: string }
  verify?: string
}

export type Project = {
  id: string
  owner: string
  repo: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
  configPath: string
  configSha: string
  config: ProjectConfig
  tasks: Task[]
}

export type WorkspaceSettings = {
  frequency: 'manual' | '15m' | '30m' | '1h' | '4h'
  paused: boolean
}

export type WorkerState = {
  busy: boolean
  startedAt: string | null
  projectId: string | null
  taskId: string | null
  lastCycleAt: string | null
  lastMessage: string | null
}

export type GithubRepository = {
  full_name: string
  name: string
  owner: { login: string }
  default_branch: string
  private: boolean
  html_url: string
  archived: boolean
  disabled: boolean
}

export type GithubContent = {
  type: 'file' | 'dir'
  name: string
  path: string
  sha: string
  content?: string
  encoding?: string
}
