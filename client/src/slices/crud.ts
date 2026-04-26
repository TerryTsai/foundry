// Cross-module surface for @foundry/crud. Adapter wraps the throwing
// internals (which return raw entities) into Result-shaped contracts.
//
// Internal-only helpers (executionOwned, sessionOwned, ticketOwned,
// assertProjectOwner, attachment*Internal, secrets-crypto helpers) are
// not exposed — they're implementation details consumed by the
// composition root, not by HTTP routes.

import type { Ctx, Result, CrudError } from '@foundry/model'
// Entity types resolve to @foundry/db row shapes — that's what the crud
// functions actually return today. The model entity types narrow status
// fields to literal unions; the DB select types keep them as plain
// strings. Use db types here to match the underlying functions exactly.
import type { Project, Ticket, Comment, Agent, Activity, Attachment, Connection } from '@foundry/db'

// Re-typed to keep the slice dependency-free. Concrete shapes mirror the
// validators in @foundry/crud — the adapter coerces between them.

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

export type MaskedConnection   = Omit<Connection, 'secrets'> & { api_key_preview: string | null }

export type DependencyChainEntry = {
  id: string; title: string; description: string
  agent_id: string | null; status: string
}

export type VerdictRow = {
  id:           string
  ticket_id:    string
  session_id:   string
  agent_id:     string
  agent_name:   string
  pass:         boolean
  reason:       string
  created_at:   string
}

export type AttachmentMeta = {
  id:         string
  ticket_id:  string | null
  comment_id: string | null
  name:       string
  mime:       string
  size:       number
  created_by: string
  created_at: string
}

export type AttachmentCreateArgs = {
  ticket_id?: string; comment_id?: string
  name: string; mime: string; bytes: Buffer; created_by: string
}

export type AttachmentBytes = { mime: string; name: string; bytes: Buffer }

export type CrudSlice = {
  // ── projects ──
  projectList:   (ctx: Ctx, args: ProjectListArgs)              => Promise<Result<Project[], CrudError>>
  projectGet:    (ctx: Ctx, id: string)                         => Promise<Result<Project, CrudError>>
  projectCreate: (ctx: Ctx, args: ProjectCreateArgs)            => Promise<Result<Project, CrudError>>
  projectUpdate: (ctx: Ctx, id: string, args: ProjectUpdateArgs) => Promise<Result<Project, CrudError>>
  projectRun:    (ctx: Ctx, id: string)                         => Promise<Result<{ ok: true }, CrudError>>
  projectTagList:(ctx: Ctx, projectId: string)                  => Promise<Result<string[], CrudError>>

  // ── tickets ──
  ticketList:             (ctx: Ctx, args: TicketListArgs)                       => Promise<Result<Ticket[], CrudError>>
  ticketGet:              (ctx: Ctx, id: string)                                 => Promise<Result<Ticket, CrudError>>
  ticketCreate:           (ctx: Ctx, args: TicketCreateArgs)                     => Promise<Result<Ticket, CrudError>>
  ticketUpdate:           (ctx: Ctx, id: string, args: TicketUpdateArgs)         => Promise<Result<Ticket, CrudError>>
  ticketCancel:           (ctx: Ctx, id: string)                                 => Promise<Result<Ticket, CrudError>>
  ticketDependencyChain:  (ctx: Ctx, id: string)                                 => Promise<Result<DependencyChainEntry[], CrudError>>
  // tagList / tagAdd / tagRemove
  tagList:                (ctx: Ctx, ticketId: string)                           => Promise<Result<string[], CrudError>>
  tagAdd:                 (ctx: Ctx, ticketId: string, tag: string)              => Promise<Result<string[], CrudError>>
  tagRemove:              (ctx: Ctx, ticketId: string, tag: string)              => Promise<Result<void, CrudError>>
  // comments / verdicts
  commentList:            (ctx: Ctx, ticketId: string)                           => Promise<Result<Comment[], CrudError>>
  commentCreate:          (ctx: Ctx, ticketId: string, args: CommentCreateArgs)  => Promise<Result<Comment, CrudError>>
  verdictList:            (ctx: Ctx, ticketId: string)                           => Promise<Result<VerdictRow[], CrudError>>

  // ── sessions ──
  sessionGet:        (ctx: Ctx, id: string)                                  => Promise<Result<unknown, CrudError>>
  sessionStatus:     (ctx: Ctx, id: string)                                  => Promise<Result<{ status: string }, CrudError>>
  sessionKill:       (ctx: Ctx, id: string)                                  => Promise<Result<{ ok: true }, CrudError>>
  verdictSet:        (ctx: Ctx, id: string, args: { pass: boolean; reason: string }) => Promise<Result<{ ok: true; recorded: { pass: boolean } }, CrudError>>
  sessionActivities: (ctx: Ctx, sessionId: string)                           => Promise<Result<Activity[], CrudError>>
  sessionByTicket:   (ctx: Ctx, ticketId: string)                            => Promise<Result<unknown[], CrudError>>
  sessionListAll:    (ctx: Ctx)                                              => Promise<Result<unknown[], CrudError>>

  // ── agents ──
  agentList:   (ctx: Ctx, args: AgentListArgs)                          => Promise<Result<Agent[], CrudError>>
  agentGet:    (ctx: Ctx, id: string)                                   => Promise<Result<Agent, CrudError>>
  agentCreate: (ctx: Ctx, args: AgentCreateArgs)                        => Promise<Result<Agent, CrudError>>
  agentUpdate: (ctx: Ctx, id: string, args: AgentUpdateArgs)            => Promise<Result<Agent, CrudError>>
  agentRemove: (ctx: Ctx, id: string)                                   => Promise<Result<{ ok: true }, CrudError>>

  // ── connections ──
  connectionList:   (ctx: Ctx)                                            => Promise<Result<MaskedConnection[], CrudError>>
  connectionGet:    (ctx: Ctx, id: string)                                => Promise<Result<MaskedConnection, CrudError>>
  connectionCreate: (ctx: Ctx, args: ConnectionCreateArgs)                => Promise<Result<MaskedConnection, CrudError>>
  connectionUpdate: (ctx: Ctx, id: string, args: ConnectionUpdateArgs)    => Promise<Result<MaskedConnection, CrudError>>
  connectionRemove: (ctx: Ctx, id: string)                                => Promise<Result<{ ok: true }, CrudError>>

  // ── attachments ──
  attachmentCreate:        (ctx: Ctx, args: AttachmentCreateArgs)            => Promise<Result<AttachmentMeta, CrudError>>
  attachmentListByTicket:  (ctx: Ctx, ticketId: string)                      => Promise<Result<AttachmentMeta[], CrudError>>
  attachmentListByComment: (ctx: Ctx, commentId: string)                     => Promise<Result<AttachmentMeta[], CrudError>>
  attachmentGetBytes:      (ctx: Ctx, id: string)                            => Promise<Result<AttachmentBytes, CrudError>>
}

// Re-export Attachment type for downstream consumers that import the
// domain shape via the slice file.
export type { Attachment }
