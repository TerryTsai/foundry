import type { Account, Connection, Project, Ticket, Comment, Agent, Session, Execution, UsageRollup, Verdict, McpServerInfo, McpToolSelection, Analytics, ProviderMetadata } from './types.js'

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
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) handleNotOk(res)
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
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
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) handleNotOk(res)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// Connections (generalized provider + integration)
export const connectionApi = {
  providers: () => get<ProviderMetadata[]>('/connection/providers'),
  list: () => get<Connection[]>('/connection'),
  get: (id: string) => get<Connection>(`/connection/${id}`),
  create: (data: { kind: string; name: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
    post<Connection>('/connection', data),
  update: (id: string, data: { name?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
    put<Connection>(`/connection/${id}`, data),
  delete: (id: string) => del<{ ok: boolean }>(`/connection/${id}`),
}

// Projects
export const projectApi = {
  list: (status?: string) => get<Project[]>(`/project${status ? `?status=${status}` : ''}`),
  get: (id: string) => get<Project>(`/project/${id}`),
  create: (data: { name: string; repo: string; max_agents?: number }) =>
    post<Project>('/project', data),
  update: (id: string, data: Partial<Project>) => put<Project>(`/project/${id}`, data),
  run: (id: string) => post<{ ok: boolean }>(`/project/${id}/run`),
  tags: (projectId: string) => get<string[]>(`/project/${projectId}/tags`),
}

// Account-level analytics. Aggregates all owned projects by default, with
// optional filters. Replaces the per-project analytics endpoint.
export const analyticsApi = {
  get: (opts: { days?: number; projectId?: string; agentId?: string } = {}) => {
    const qs = new URLSearchParams()
    if (opts.days      !== undefined) qs.set('days',      String(opts.days))
    if (opts.projectId !== undefined) qs.set('projectId', opts.projectId)
    if (opts.agentId   !== undefined) qs.set('agentId',   opts.agentId)
    const s = qs.toString()
    return get<Analytics>(`/analytics${s ? `?${s}` : ''}`)
  },
}

// Tickets
export const ticketApi = {
  list: (params?: { projectId?: string; agentId?: string; status?: string; tag?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    if (params?.agentId)   qs.set('agentId',   params.agentId)
    if (params?.status)    qs.set('status',    params.status)
    if (params?.tag)       qs.set('tag',       params.tag)
    return get<Ticket[]>(`/ticket${qs.toString() ? `?${qs}` : ''}`)
  },
  get: (id: string) => get<Ticket>(`/ticket/${id}`),
  chain: (id: string) => get<Ticket[]>(`/ticket/${id}/chain`),
  create: (data: { project_id: string; title: string; description: string; agent_id?: string; depends_on?: string; created_by: string }) =>
    post<Ticket>('/ticket', data),
  update: (id: string, data: { title?: string; description?: string; agent_id?: string }) =>
    put<Ticket>(`/ticket/${id}`, data),
  cancel: (id: string) => post<Ticket>(`/ticket/${id}/cancel`),
  usage: (id: string) => get<UsageRollup>(`/ticket/${id}/usage`),
  tags: (ticketId: string) => get<string[]>(`/ticket/${ticketId}/tag`),
  addTag: (ticketId: string, tag: string) => post<string[]>(`/ticket/${ticketId}/tag`, { tag }),
  removeTag: (ticketId: string, tag: string) => del<void>(`/ticket/${ticketId}/tag/${encodeURIComponent(tag)}`),
  verdicts: (ticketId: string) => get<Verdict[]>(`/ticket/${ticketId}/verdict`),
  sessions: (ticketId: string) => get<Session[]>(`/ticket/${ticketId}/session`),
  events: (ticketId: string) => get<import('./types.js').Event[]>(`/ticket/${ticketId}/event`),
}

// Attachments
export interface AttachmentMeta {
  id: string
  ticket_id: string | null
  comment_id: string | null
  name: string
  mime: string
  size: number
  created_by: string
  created_at: string
}

export const attachmentApi = {
  listByTicket: (ticketId: string) => get<AttachmentMeta[]>(`/ticket/${ticketId}/attachment`),
  upload: async (ticketId: string, file: File): Promise<AttachmentMeta> => {
    const url = `/ticket/${ticketId}/attachment?name=${encodeURIComponent(file.name)}`
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) handleNotOk(res)
    return res.json() as Promise<AttachmentMeta>
  },
  bytesUrl: (id: string) => `/attachment/${id}`,
}

// Comments
export const commentApi = {
  list: (ticketId: string) => get<Comment[]>(`/ticket/${ticketId}/comment`),
  create: (ticketId: string, data: { author: string; body: string }) =>
    post<Comment>(`/ticket/${ticketId}/comment`, data),
}

// Tags
export const tagApi = {
  list:   (ticketId: string)               => get<string[]>(`/ticket/${ticketId}/tag`),
  add:    (ticketId: string, tag: string)  => post<string[]>(`/ticket/${ticketId}/tag`, { tag }),
  remove: (ticketId: string, tag: string)  => del<{ ok: boolean }>(`/ticket/${ticketId}/tag/${encodeURIComponent(tag)}`),
}

// Sessions
export const sessionApi = {
  get: (id: string) => get<Session>(`/session/${id}`),
  byTicket: (ticketId: string) => get<Session[]>(`/ticket/${ticketId}/session`),
  activities: (sessionId: string) => get<import('./types.js').Activity[]>(`/session/${sessionId}/activity`),
  executions: (sessionId: string) => get<Execution[]>(`/session/${sessionId}/execution`),
  usage: (id: string) => get<UsageRollup>(`/session/${id}/usage`),
}

// Agents
export const agentApi = {
  list: () => get<Agent[]>('/agent'),
  get: (id: string) => get<Agent>(`/agent/${id}`),
  mcp: () => get<McpServerInfo[]>('/agent/mcp'),
  create: (data: { connection_id: string; name: string; model: string; description: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: McpToolSelection; verifiers?: string[] }) =>
    post<Agent>('/agent', data),
  update: (id: string, data: { connection_id?: string; model?: string; description?: string; max_tokens?: number; max_steps?: number; temperature?: number; reasoning_budget?: number | null; tools?: McpToolSelection; verifiers?: string[] | null }) =>
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
