import type { Account, Connection, Project, Ticket, Comment, Agent, Session, Execution, UsageRollup } from './types.js'

const cache = new Map<string, { data: unknown; at: number }>()
const CACHE_TTL = 30_000 // 30 seconds

// Centralised non-OK handler. 401 means the session is gone — bounce to /login
// unless we're already there. Returns a never-resolving promise so callers
// (loaders, components) don't see a thrown error mid-redirect.
function handleNotOk(res: Response): never {
  if (res.status === 401 && location.pathname !== '/login') {
    location.assign('/login')
    return new Promise<never>(() => {}) as never
  }
  throw new Error(`${res.status} ${res.statusText}`)
}

async function get<T>(url: string): Promise<T> {
  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data as T
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) handleNotOk(res)
  const data = await res.json() as T
  cache.set(url, { data, at: Date.now() })
  return data
}

export function bustCache() { cache.clear() }

async function post<T>(url: string, body?: unknown): Promise<T> {
  bustCache()
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) handleNotOk(res)
  return res.json() as Promise<T>
}

async function put<T>(url: string, body: unknown): Promise<T> {
  bustCache()
  const res = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) handleNotOk(res)
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  bustCache()
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) handleNotOk(res)
  return res.json() as Promise<T>
}

// Connections (generalized provider + integration)
export const connectionApi = {
  list: () => get<Connection[]>('/connection'),
  get: (id: string) => get<Connection>(`/connection/${id}`),
  create: (data: { project_id?: string; kind: string; name: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
    post<Connection>('/connection', data),
  update: (id: string, data: { name?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
    put<Connection>(`/connection/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/connection/${id}`),
}

// Projects
export const projectApi = {
  list: (status?: string) => get<Project[]>(`/project${status ? `?status=${status}` : ''}`),
  get: (id: string) => get<Project>(`/project/${id}`),
  create: (data: { name: string; repo: string; schedule_interval?: number; concurrency_limit?: number }) =>
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
  usage: (id: string) => get<UsageRollup>(`/ticket/${id}/usage`),
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
  usage: (id: string) => get<UsageRollup>(`/session/${id}/usage`),
}

// Agents
export const agentApi = {
  list: (projectId?: string) => get<Agent[]>(`/agent${projectId ? `?projectId=${projectId}` : ''}`),
  get: (id: string) => get<Agent>(`/agent/${id}`),
  tools: () => get<string[]>('/agent/tools'),
  create: (data: { project_id: string; connection_id: string; name: string; model: string; prompt: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: string[] }) =>
    post<Agent>('/agent', data),
  update: (id: string, data: { connection_id?: string; model?: string; prompt?: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: string[] }) =>
    put<Agent>(`/agent/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/agent/${id}`),
  usage: (id: string) => get<UsageRollup>(`/agent/${id}/usage`),
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

// Auth
export const authApi = {
  me: () => get<Account>('/auth/me'),
  logout: () => post<void>('/auth/logout'),
}
