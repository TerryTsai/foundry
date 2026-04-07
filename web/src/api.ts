import type { Project, Ticket, Comment, Agent, Session, Execution } from './types.js'

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
  create: (data: { name: string; schedule_interval?: number; concurrency_limit?: number }) =>
    post<Project>('/project', data),
  update: (id: string, data: Partial<Project>) => put<Project>(`/project/${id}`, data),
  run: (id: string) => post<{ ok: boolean }>(`/project/${id}/run`),
}

// Tickets
export const ticketApi = {
  list: (params?: { projectId?: string; agentId?: string; status?: string; parentId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    if (params?.agentId) qs.set('agentId', params.agentId)
    if (params?.status) qs.set('status', params.status)
    if (params?.parentId) qs.set('parentId', params.parentId)
    return get<Ticket[]>(`/ticket${qs.toString() ? `?${qs}` : ''}`)
  },
  get: (id: string) => get<Ticket>(`/ticket/${id}`),
  chain: (id: string) => get<Ticket[]>(`/ticket/${id}/chain`),
  create: (data: { project_id: string; title: string; body: string; agent_id?: string; priority?: number; parent_id?: string; created_by: string }) =>
    post<Ticket>('/ticket', data),
  update: (id: string, data: { title?: string; body?: string; agent_id?: string; priority?: number }) =>
    put<Ticket>(`/ticket/${id}`, data),
  reopen: (id: string) => post<Ticket>(`/ticket/${id}/reopen`),
}

// Comments
export const commentApi = {
  list: (ticketId: string) => get<Comment[]>(`/ticket/${ticketId}/comment`),
  create: (ticketId: string, data: { author: string; body: string }) =>
    post<Comment>(`/ticket/${ticketId}/comment`, data),
}

// Agents
export const agentApi = {
  list: (projectId?: string) => get<Agent[]>(`/agent${projectId ? `?projectId=${projectId}` : ''}`),
  get: (id: string) => get<Agent>(`/agent/${id}`),
  create: (data: { project_id: string; name: string; model: string; prompt: string; max_tokens?: number; max_steps?: number; temperature?: number }) =>
    post<Agent>('/agent', data),
  update: (id: string, data: { model?: string; prompt?: string; max_tokens?: number; max_steps?: number; temperature?: number }) =>
    put<Agent>(`/agent/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/agent/${id}`),
}

// Logs
export const logsApi = {
  sessions: () => get<Session[]>('/session'),
  executions: () => get<Execution[]>('/execution'),
  nginx: async (): Promise<string[]> => {
    const res = await fetch('/log/nginx')
    if (!res.ok) return []
    const text = await res.text()
    return text.split('\n').filter(Boolean).slice(-500)
  },
}

// Files
export const fileApi = {
  listFiles: (projectId: string) => get<string[]>(`/file/${projectId}`),
  readFile: async (projectId: string, path: string): Promise<string> => {
    const res = await fetch(`/file/${projectId}/${path}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.text()
  },
}
