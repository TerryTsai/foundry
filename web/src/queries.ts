// Query keys and queryOptions for every GET endpoint in the app.
//
// Conventions:
// - Keys are arrays with a stable root (['ticket'], ['agent'], etc.) so
//   mutations can invalidate a whole domain with one call.
// - Nested keys follow resource hierarchy: ['ticket', id, 'comments'].
// - Loaders call queryClient.ensureQueryData(options) to prefetch;
//   components call useQuery(options) to read.

import { queryOptions } from '@tanstack/react-query'
import {
  connectionApi, projectApi, analyticsApi, ticketApi, commentApi,
  sessionApi, agentApi, executionApi, authApi,
} from './api.js'

// ── Keys ──

export const qk = {
  auth: {
    me:       () => ['auth', 'me'] as const,
  },
  connection: {
    all:      () => ['connection'] as const,
    list:     () => ['connection', 'list'] as const,
    providers:() => ['connection', 'providers'] as const,
    byId:     (id: string) => ['connection', id] as const,
  },
  project: {
    all:      () => ['project'] as const,
    list:     (status?: string) => ['project', 'list', status ?? null] as const,
    byId:     (id: string) => ['project', id] as const,
    tags:     (id: string) => ['project', id, 'tags'] as const,
  },
  agent: {
    all:      () => ['agent'] as const,
    list:     () => ['agent', 'list'] as const,
    mcp:      () => ['agent', 'mcp'] as const,
    byId:     (id: string) => ['agent', id] as const,
    usage:    (id: string) => ['agent', id, 'usage'] as const,
  },
  ticket: {
    all:      () => ['ticket'] as const,
    list:     (params?: { projectId?: string; agentId?: string; status?: string; tag?: string }) =>
              ['ticket', 'list', params ?? {}] as const,
    byId:     (id: string) => ['ticket', id] as const,
    chain:    (id: string) => ['ticket', id, 'chain'] as const,
    usage:    (id: string) => ['ticket', id, 'usage'] as const,
    tags:     (id: string) => ['ticket', id, 'tags'] as const,
    verdicts: (id: string) => ['ticket', id, 'verdicts'] as const,
    sessions: (id: string) => ['ticket', id, 'sessions'] as const,
    comments: (id: string) => ['ticket', id, 'comments'] as const,
    events:   (id: string) => ['ticket', id, 'events'] as const,
  },
  session: {
    all:      () => ['session'] as const,
    byId:     (id: string) => ['session', id] as const,
    activities: (id: string) => ['session', id, 'activities'] as const,
    executions: (id: string) => ['session', id, 'executions'] as const,
    usage:    (id: string) => ['session', id, 'usage'] as const,
  },
  execution: {
    all:      () => ['execution'] as const,
    byId:     (id: string) => ['execution', id] as const,
  },
  analytics: {
    get:      (opts: { days?: number; projectId?: string; agentId?: string }) =>
              ['analytics', opts] as const,
  },
}

// ── queryOptions ──

export const authMeOpts          = () => queryOptions({ queryKey: qk.auth.me(),          queryFn: authApi.me })

export const connectionListOpts  = () => queryOptions({ queryKey: qk.connection.list(),       queryFn: connectionApi.list })
export const connectionProvOpts  = () => queryOptions({ queryKey: qk.connection.providers(),  queryFn: connectionApi.providers })

export const projectListOpts     = (status?: string) => queryOptions({ queryKey: qk.project.list(status), queryFn: () => projectApi.list(status) })
export const projectGetOpts      = (id: string) => queryOptions({ queryKey: qk.project.byId(id),  queryFn: () => projectApi.get(id) })
export const projectTagsOpts     = (id: string) => queryOptions({ queryKey: qk.project.tags(id),  queryFn: () => projectApi.tags(id) })

export const agentListOpts       = () => queryOptions({ queryKey: qk.agent.list(), queryFn: agentApi.list })
export const agentMcpOpts        = () => queryOptions({ queryKey: qk.agent.mcp(),  queryFn: agentApi.mcp })
export const agentGetOpts        = (id: string) => queryOptions({ queryKey: qk.agent.byId(id),   queryFn: () => agentApi.get(id) })
export const agentUsageOpts      = (id: string) => queryOptions({ queryKey: qk.agent.usage(id),  queryFn: () => agentApi.usage(id) })

export const ticketListOpts      = (params?: { projectId?: string; agentId?: string; status?: string; tag?: string }) =>
  queryOptions({ queryKey: qk.ticket.list(params), queryFn: () => ticketApi.list(params) })
export const ticketGetOpts       = (id: string) => queryOptions({ queryKey: qk.ticket.byId(id),     queryFn: () => ticketApi.get(id) })
export const ticketChainOpts     = (id: string) => queryOptions({ queryKey: qk.ticket.chain(id),    queryFn: () => ticketApi.chain(id) })
export const ticketUsageOpts     = (id: string) => queryOptions({ queryKey: qk.ticket.usage(id),    queryFn: () => ticketApi.usage(id) })
export const ticketTagsOpts      = (id: string) => queryOptions({ queryKey: qk.ticket.tags(id),     queryFn: () => ticketApi.tags(id) })
export const ticketVerdictsOpts  = (id: string) => queryOptions({ queryKey: qk.ticket.verdicts(id), queryFn: () => ticketApi.verdicts(id) })
export const ticketSessionsOpts  = (id: string) => queryOptions({ queryKey: qk.ticket.sessions(id), queryFn: () => ticketApi.sessions(id) })
export const ticketEventsOpts    = (id: string) => queryOptions({ queryKey: qk.ticket.events(id),   queryFn: () => ticketApi.events(id) })
export const ticketCommentsOpts  = (id: string) => queryOptions({ queryKey: qk.ticket.comments(id), queryFn: () => commentApi.list(id) })

export const sessionGetOpts        = (id: string) => queryOptions({ queryKey: qk.session.byId(id),        queryFn: () => sessionApi.get(id) })
export const sessionActivitiesOpts = (id: string) => queryOptions({ queryKey: qk.session.activities(id),  queryFn: () => sessionApi.activities(id) })
export const sessionExecutionsOpts = (id: string) => queryOptions({ queryKey: qk.session.executions(id),  queryFn: () => sessionApi.executions(id) })
export const sessionUsageOpts      = (id: string) => queryOptions({ queryKey: qk.session.usage(id),       queryFn: () => sessionApi.usage(id) })

export const executionGetOpts    = (id: string) => queryOptions({ queryKey: qk.execution.byId(id), queryFn: () => executionApi.get(id) })

export const analyticsGetOpts    = (opts: { days?: number; projectId?: string; agentId?: string } = {}) =>
  queryOptions({ queryKey: qk.analytics.get(opts), queryFn: () => analyticsApi.get(opts) })
