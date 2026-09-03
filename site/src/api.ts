import type { GithubCommit, Project, Repository, Task, TaskStatus, Workspace } from './types.js'

export async function authStatus(): Promise<{ connected: boolean; login: string | null; oauthConfigured: boolean }> {
  return request('/auth/status')
}

export async function getWorkspace(): Promise<Workspace> {
  return request('/api/workspace')
}

export async function getProject(owner: string, repo: string): Promise<Project> {
  return request(`/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
}

export async function getRepositories(): Promise<Repository[]> {
  return request('/api/repositories')
}

export async function enableRepository(repository: Repository): Promise<void> {
  await request('/api/repositories/enable', { method: 'POST', body: JSON.stringify({ repo: repository.full_name, branch: repository.default_branch }) })
}

export async function createTask(owner: string, repo: string, input: { title: string; description: string; start: boolean }): Promise<Task> {
  return request(`/api/projects/${owner}/${repo}/tasks`, { method: 'POST', body: JSON.stringify(input) })
}

export async function setTaskStatus(owner: string, repo: string, taskId: string, status: TaskStatus): Promise<Task> {
  return request(`/api/projects/${owner}/${repo}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export async function updateTask(owner: string, repo: string, taskId: string, patch: { title: string; description: string }): Promise<Task> {
  return request(`/api/projects/${owner}/${repo}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function steer(owner: string, repo: string, message: string, taskId?: string): Promise<{ action: string }> {
  return request(`/api/projects/${owner}/${repo}/steer`, { method: 'POST', body: JSON.stringify({ message, taskId }) })
}

export async function saveWorkerSettings(settings: Workspace['settings']): Promise<void> {
  await request('/api/workspace/settings', { method: 'PATCH', body: JSON.stringify(settings) })
}

export async function runWorker(): Promise<void> {
  await request('/api/worker/run', { method: 'POST' })
}

export async function getHistory(owner: string, repo: string, taskId: string): Promise<GithubCommit[]> {
  return request(`/api/projects/${owner}/${repo}/tasks/${taskId}/history`)
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  if (response.status === 401) throw new Error('unauthorized')
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    throw new Error(body.error || response.statusText)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
