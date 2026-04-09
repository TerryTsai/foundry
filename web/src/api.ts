import type { Provider, Project, Ticket, Comment, Agent, Session, Execution } from './types.js'

const cache = new Map<string, { data: unknown; at: number }>()
const CACHE_TTL = 30_000 // 30 seconds

async function get<T>(url: string): Promise<T> {
  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data as T
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = await res.json() as T
  cache.set(url, { data, at: Date.now() })
  return data
}

export function bustCache() { cache.clear() }

async function post<T>(url: string, body?: unknown): Promise<T> {
  bustCache()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function put<T>(url: string, body: unknown): Promise<T> {
  bustCache()
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  bustCache()
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// Providers
export const providerApi = {
  list: () => get<Provider[]>('/provider'),
  create: (data: { name: string; api_key: string }) => post<Provider>('/provider', data),
  update: (id: string, data: { api_key: string }) => put<Provider>(`/provider/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/provider/${id}`),
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

// Sessions
export const sessionApi = {
  get: (id: string) => get<Session>(`/session/${id}`),
  byTicket: (ticketId: string) => get<Session[]>(`/ticket/${ticketId}/session`),
  messages: (sessionId: string) => get<import('./types.js').Message[]>(`/session/${sessionId}/message`),
  executions: (sessionId: string) => get<Execution[]>(`/session/${sessionId}/execution`),
}

// Agents
export const agentApi = {
  list: (projectId?: string) => get<Agent[]>(`/agent${projectId ? `?projectId=${projectId}` : ''}`),
  get: (id: string) => get<Agent>(`/agent/${id}`),
  tools: () => get<string[]>('/agent/tools'),
  create: (data: { project_id: string; name: string; model: string; prompt: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: string[] }) =>
    post<Agent>('/agent', data),
  update: (id: string, data: { model?: string; prompt?: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: string[] }) =>
    put<Agent>(`/agent/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/agent/${id}`),
}

// Executions
export const executionApi = {
  get: (id: string) => get<Execution>(`/execution/${id}`),
}

// Logs
export const logsApi = {
  sessions: () => get<Session[]>('/session'),
  executions: () => get<Execution[]>('/execution'),
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
