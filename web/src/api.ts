import type { Project, Ticket, AgentDef, AgentSession, SandboxRun } from './types.js'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// Projects
export const projectApi = {
  list: (status?: string) => get<Project[]>(`/project${status ? `?status=${status}` : ''}`),
  get: (id: string) => get<Project>(`/project/${id}`),
  create: (data: { name: string; workspace: string; schedule_interval?: number; concurrency_limit?: number }) =>
    post<Project>('/project', data),
  update: (id: string, data: Partial<Project>) => put<Project>(`/project/${id}`, data),
  run: (id: string) => post<{ ok: boolean }>(`/project/${id}/run`),
}

// Tickets
export const ticketApi = {
  list: (params?: { projectId?: string; agent?: string; status?: string; parentId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    if (params?.agent) qs.set('agent', params.agent)
    if (params?.status) qs.set('status', params.status)
    if (params?.parentId) qs.set('parentId', params.parentId)
    return get<Ticket[]>(`/ticket${qs.toString() ? `?${qs}` : ''}`)
  },
  get: (id: string) => get<Ticket>(`/ticket/${id}`),
  chain: (id: string) => get<Ticket[]>(`/ticket/${id}/chain`),
  create: (data: { project_id: string; title: string; body: string; agent: string; parent_id?: string; created_by: string }) =>
    post<Ticket>('/ticket', data),
  update: (id: string, data: { body?: string; notes?: string }) => put<Ticket>(`/ticket/${id}`, data),
  reopen: (id: string) => post<Ticket>(`/ticket/${id}/reopen`),
}

// Agent definitions
export const agentApi = {
  list: (projectId?: string) => get<AgentDef[]>(`/agent${projectId ? `?projectId=${projectId}` : ''}`),
  get: (id: string) => get<AgentDef>(`/agent/${id}`),
  create: (data: { project_id: string; name: string; prompt: string }) =>
    post<AgentDef>('/agent', data),
  update: (id: string, data: { prompt?: string }) =>
    put<AgentDef>(`/agent/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/agent/${id}`),
}

// Logs
export const logsApi = {
  sessions: () => get<AgentSession[]>('/session'),
  sandboxRuns: () => get<SandboxRun[]>('/sandbox'),
  nginx: async (): Promise<string[]> => {
    const res = await fetch('/log/nginx')
    if (!res.ok) return []
    const text = await res.text()
    return text.split('\n').filter(Boolean).slice(-500)
  },
}

// Repo
export const repoApi = {
  listFiles: (slug: string) => get<string[]>(`/repo/${slug}/file`),
  readFile: async (slug: string, path: string): Promise<string> => {
    const res = await fetch(`/repo/${slug}/file/${path}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.text()
  },
}
