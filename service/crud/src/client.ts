// Cross-service contract for @foundry/crud. Types only — no value
// imports beyond schema.ts and @foundry/model. Consumers (engine,
// reconciler, sandbox, auth, server route handlers) import this
// CrudClient when they need to call crud.
//
// Two surface flavors:
//   - Owned reads/writes (`projectGet`, `ticketGet`, etc.) — derive
//     accountId from ctx and check ownership; surface route-facing
//     errors (not_found / permission_denied collapsed).
//   - Internal helpers (`*ById`, `*Insert`, `eventCreate`, …) — no
//     ownership check; used by reconciler ticks and engine sessions
//     that act on rows the user is unaware of.

import type { Ctx, Result } from '@foundry/model'
import type {
  Account, Activity, Agent, AuthSession, Comment, Connection,
  Event, Execution, Project, Session, Ticket,
} from '@foundry/db'

import type {
  AttachmentMeta, AttachmentCreateInput, AttachmentBytes,
  DependencyChainEntry, VerdictRow,
  MaskedConnection, EventCreateInput, ExecutionInsertInput, CrudError,
} from './schema.js'

export type ProjectListArgs    = { status?: string }
export type ProjectCreateArgs  = { name: string; description?: string; repo: string; max_agents?: number }
export type ProjectUpdateArgs  = { name?: string; description?: string; repo?: string; status?: 'active' | 'archived'; max_agents?: number }

export type TicketListArgs     = { projectId?: string; agentId?: string; status?: 'created' | 'waiting' | 'running' | 'finished' | 'failed' | 'cancelled'; tag?: string }
export type TicketCreateArgs   = { project_id: string; agent_id?: string; title: string; description: string; depends_on?: string; created_by: string }
export type TicketUpdateArgs   = { title?: string; description?: string; agent_id?: string }

export type CommentCreateArgs  = { author: string; body: string; session_id?: string }

export type AgentListArgs      = { accountId?: string }
export type AgentCreateArgs    = {
  connection_id: string; name: string; model: string; description: string
  max_tokens?: number; max_steps?: number; temperature?: number
  reasoning_budget?: number | null
  tools?: string[] | Record<string, '*' | string[]>
  verifiers?: string[]
}
export type AgentUpdateArgs    = {
  connection_id?: string; model?: string; description?: string
  max_tokens?: number; max_steps?: number; temperature?: number | null
  reasoning_budget?: number | null
  tools?: string[] | Record<string, '*' | string[]>
  verifiers?: string[] | null
}

export type ConnectionCreateArgs = { kind: string; name: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }
export type ConnectionUpdateArgs = { name?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> }

export type AccountUpsertByGithubArgs = {
  github_id:  number
  login:      string
  name:       string | null
  email:      string | null
  avatar_url: string | null
}

export type AuthSessionInsertArgs = {
  id: string; account_id: string; created_at: string; expires_at: string
}

export type CrudClient = {
  // ── projects (owned) ──
  projectList:   (ctx: Ctx, args: ProjectListArgs)              => Promise<Result<Project[], CrudError>>
  projectGet:    (ctx: Ctx, id: string)                         => Promise<Result<Project, CrudError>>
  projectCreate: (ctx: Ctx, args: ProjectCreateArgs)            => Promise<Result<Project, CrudError>>
  projectUpdate: (ctx: Ctx, id: string, args: ProjectUpdateArgs) => Promise<Result<Project, CrudError>>
  projectRun:    (ctx: Ctx, id: string)                         => Promise<Result<{ ok: true }, CrudError>>
  projectTagList:(ctx: Ctx, projectId: string)                  => Promise<Result<string[], CrudError>>

  // ── tickets (owned) ──
  ticketList:             (ctx: Ctx, args: TicketListArgs)                       => Promise<Result<Ticket[], CrudError>>
  ticketGet:              (ctx: Ctx, id: string)                                 => Promise<Result<Ticket, CrudError>>
  ticketCreate:           (ctx: Ctx, args: TicketCreateArgs)                     => Promise<Result<Ticket, CrudError>>
  ticketUpdate:           (ctx: Ctx, id: string, args: TicketUpdateArgs)         => Promise<Result<Ticket, CrudError>>
  ticketCancel:           (ctx: Ctx, id: string)                                 => Promise<Result<Ticket, CrudError>>
  ticketDependencyChain:  (ctx: Ctx, id: string)                                 => Promise<Result<DependencyChainEntry[], CrudError>>
  tagList:                (ctx: Ctx, ticketId: string)                           => Promise<Result<string[], CrudError>>
  tagAdd:                 (ctx: Ctx, ticketId: string, tag: string)              => Promise<Result<string[], CrudError>>
  tagRemove:              (ctx: Ctx, ticketId: string, tag: string)              => Promise<Result<void, CrudError>>
  commentList:            (ctx: Ctx, ticketId: string)                           => Promise<Result<Comment[], CrudError>>
  commentCreate:          (ctx: Ctx, ticketId: string, args: CommentCreateArgs)  => Promise<Result<Comment, CrudError>>
  verdictList:            (ctx: Ctx, ticketId: string)                           => Promise<Result<VerdictRow[], CrudError>>

  // ── sessions (owned) ──
  sessionGet:        (ctx: Ctx, id: string)                                  => Promise<Result<unknown, CrudError>>
  sessionStatus:     (ctx: Ctx, id: string)                                  => Promise<Result<{ status: string }, CrudError>>
  sessionKill:       (ctx: Ctx, id: string)                                  => Promise<Result<{ ok: true }, CrudError>>
  verdictSet:        (ctx: Ctx, id: string, args: { pass: boolean; reason: string }) => Promise<Result<{ ok: true; recorded: { pass: boolean } }, CrudError>>
  sessionActivities: (ctx: Ctx, sessionId: string)                           => Promise<Result<Activity[], CrudError>>
  sessionByTicket:   (ctx: Ctx, ticketId: string)                            => Promise<Result<unknown[], CrudError>>
  sessionListAll:    (ctx: Ctx)                                              => Promise<Result<unknown[], CrudError>>

  // ── agents (owned + cross-account list) ──
  agentList:   (ctx: Ctx, args: AgentListArgs)                          => Promise<Result<Agent[], CrudError>>
  agentGet:    (ctx: Ctx, id: string)                                   => Promise<Result<Agent, CrudError>>
  agentCreate: (ctx: Ctx, args: AgentCreateArgs)                        => Promise<Result<Agent, CrudError>>
  agentUpdate: (ctx: Ctx, id: string, args: AgentUpdateArgs)            => Promise<Result<Agent, CrudError>>
  agentRemove: (ctx: Ctx, id: string)                                   => Promise<Result<{ ok: true }, CrudError>>

  // ── connections (owned) ──
  connectionList:   (ctx: Ctx)                                            => Promise<Result<MaskedConnection[], CrudError>>
  connectionGet:    (ctx: Ctx, id: string)                                => Promise<Result<MaskedConnection, CrudError>>
  connectionCreate: (ctx: Ctx, args: ConnectionCreateArgs)                => Promise<Result<MaskedConnection, CrudError>>
  connectionUpdate: (ctx: Ctx, id: string, args: ConnectionUpdateArgs)    => Promise<Result<MaskedConnection, CrudError>>
  connectionRemove: (ctx: Ctx, id: string)                                => Promise<Result<{ ok: true }, CrudError>>

  // ── attachments (owned) ──
  attachmentCreate:        (ctx: Ctx, args: AttachmentCreateInput)           => Promise<Result<AttachmentMeta, CrudError>>
  attachmentListByTicket:  (ctx: Ctx, ticketId: string)                      => Promise<Result<AttachmentMeta[], CrudError>>
  attachmentListByComment: (ctx: Ctx, commentId: string)                     => Promise<Result<AttachmentMeta[], CrudError>>
  attachmentGetBytes:      (ctx: Ctx, id: string)                            => Promise<Result<AttachmentBytes, CrudError>>

  // ── internal: entity reads (no ownership) ──
  ticketGetById:        (ctx: Ctx, id: string)        => Promise<Result<Ticket      | undefined, CrudError>>
  ticketAllByProject:   (ctx: Ctx, projectId: string, status: string) => Promise<Result<Ticket[], CrudError>>
  projectGetById:       (ctx: Ctx, id: string)        => Promise<Result<Project     | undefined, CrudError>>
  projectsActive:       (ctx: Ctx)                    => Promise<Result<Project[], CrudError>>
  sessionGetById:       (ctx: Ctx, id: string)        => Promise<Result<Session     | undefined, CrudError>>
  sessionRunning:       (ctx: Ctx)                    => Promise<Result<Session[], CrudError>>
  sessionRunningForTicket: (ctx: Ctx, ticketId: string) => Promise<Result<Session[], CrudError>>
  sessionsByTicketRaw:  (ctx: Ctx, ticketId: string)  => Promise<Result<Session[], CrudError>>
  agentGetById:         (ctx: Ctx, id: string)        => Promise<Result<Agent       | undefined, CrudError>>
  agentListInternal:    (ctx: Ctx, accountId: string) => Promise<Result<Agent[], CrudError>>
  connectionGetById:    (ctx: Ctx, id: string)        => Promise<Result<Connection  | undefined, CrudError>>
  connectionByAccount:  (ctx: Ctx, accountId: string) => Promise<Result<Connection[], CrudError>>
  accountGetById:       (ctx: Ctx, id: string)        => Promise<Result<Account     | undefined, CrudError>>
  commentByTicket:      (ctx: Ctx, ticketId: string)  => Promise<Result<Comment[], CrudError>>
  verdictBySession:     (ctx: Ctx, sessionId: string) => Promise<Result<VerdictRow  | undefined, CrudError>>
  verdictByTicket:      (ctx: Ctx, ticketId: string)  => Promise<Result<VerdictRow[], CrudError>>
  activityByTurnOrder:  (ctx: Ctx, sessionId: string, turnId: string, orderIndex: number) => Promise<Result<Activity | undefined, CrudError>>
  attachmentListByTicketInternal: (ctx: Ctx, ticketId: string) => Promise<Result<AttachmentMeta[], CrudError>>

  // ── internal: entity writes (no ownership) ──
  ticketTransition:     (ctx: Ctx, id: string, from: string, to: string) => Promise<Result<boolean, CrudError>>
  ticketUpdateById:     (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Ticket, CrudError>>
  sessionUpdateById:    (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Session, CrudError>>
  sessionInsert:        (ctx: Ctx, data: Record<string, unknown>) => Promise<Result<Session, CrudError>>
  connectionUpdateById: (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Connection, CrudError>>
  activityCreate:       (ctx: Ctx, data: Record<string, unknown>) => Promise<Result<Activity, CrudError>>
  activityUpdate:       (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Activity, CrudError>>
  accountUpsertByGithubId: (ctx: Ctx, args: AccountUpsertByGithubArgs) => Promise<Result<Account, CrudError>>
  claimUnownedProjects: (ctx: Ctx, ownerLogin: string) => Promise<Result<number, CrudError>>

  // ── auth-session storage ──
  authSessionGet:    (ctx: Ctx, id: string) => Promise<Result<AuthSession | undefined, CrudError>>
  authSessionInsert: (ctx: Ctx, args: AuthSessionInsertArgs) => Promise<Result<AuthSession, CrudError>>
  authSessionRemove: (ctx: Ctx, id: string) => Promise<Result<void, CrudError>>

  // ── event log ──
  eventCreate: (ctx: Ctx, data: EventCreateInput) => Promise<Result<Event, CrudError>>
  eventLatest: (ctx: Ctx, entityType: string, entityId: string) => Promise<Result<Event | undefined, CrudError>>

  // ── execution metering (sandbox + routes) ──
  executionList:          (ctx: Ctx) => Promise<Result<Execution[], CrudError>>
  executionBySession:     (ctx: Ctx, sessionId: string) => Promise<Result<Execution[], CrudError>>
  executionMeterCreate:   (ctx: Ctx, data: ExecutionInsertInput) => Promise<Result<Execution, CrudError>>
  executionMeterUpdate:   (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Execution, CrudError>>
  executionMarkCancelled: (ctx: Ctx, id: string) => Promise<Result<void, CrudError>>
}

// Re-export Connection so consumers can type their locals without
// reaching across module boundaries themselves.
export type { Connection }
