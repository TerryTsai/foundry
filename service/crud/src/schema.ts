// Shapes for @foundry/crud. Types only — zod validators live in
// validate.ts. All inline interfaces previously declared in feature
// files (attachment, execution, session, ticket, repo) are consolidated
// here per the schema.ts standard.

import type { Attachment, Connection } from '@foundry/db'

// ── Attachment ──────────────────────────────────────────────────────

export interface AttachmentMeta {
  id:         string
  ticket_id:  string | null
  comment_id: string | null
  name:       string
  mime:       string
  size:       number
  created_by: string
  created_at: string
}

export interface AttachmentCreateInput {
  ticket_id?:  string
  comment_id?: string
  name:        string
  mime:        string
  bytes:       Buffer
  created_by:  string
}

export interface AttachmentBytes {
  mime:  string
  name:  string
  bytes: Buffer
}

// Re-export for feature files that need to type Attachment without
// importing @foundry/db directly.
export type { Attachment }

// ── Execution / activity / dependency ───────────────────────────────

export interface ExecutionInsertInput {
  id?:          string
  session_id?:  string | null
  tool_name?:   string | null
  tool_input?:  string | null
  tool_use_id?: string | null
  command:      string
  status:       string
  timeout_ms:   number
  memory_mb?:   number | null
  started_at:   string
}

export interface ActivityCreateInput {
  session_id:    string
  turn_id?:      string | null
  kind:          'prompt' | 'thought' | 'said' | 'tool_call' | 'reconcile'
  order_index?:  number
  payload:       unknown
  tool_use_id?:  string
  execution_id?: string
  tokens_in?:    number | null
  tokens?:       number | null
}

export interface DependencyChainEntry {
  id:          string
  title:       string
  description: string
  agent_id:    string | null
  status:      string
}

export interface VerdictRow {
  id:         string       // session.id (1:1)
  session_id: string
  agent_id:   string
  ticket_id:  string
  pass:       boolean
  reason:     string
  created_at: string       // session.ended_at ?? session.started_at
}

// ── Crypto callbacks ─────────────────────────────────────────────────
// ── Connection types ────────────────────────────────────────────────
// Per-row provider metadata + the masked shape returned by routes (so
// secrets never serialize directly). Concrete providers live in mcp;
// crud only needs the structural shape to mask credential previews.

export type MaskedConnection = Omit<Connection, 'secrets'> & { api_key_preview: string | null }

export interface ConnectionProviderField {
  key:       string
  label:     string
  type?:     string
  required?: boolean
}

export interface ConnectionProviderSpec {
  kind:        string
  name:        string
  credentials: ConnectionProviderField[]
  validate?:   (secrets: Record<string, unknown>, config: Record<string, unknown>) => string | null
}

export interface EventCreateInput {
  entity_type:    string
  entity_id:      string
  kind:           string
  data?:          string
  caused_by:      string
  caused_by_id?:  string | null
}

// ── Error union ─────────────────────────────────────────────────────

export type CrudError =
  | { kind: 'not_found';          entity: string; id: string }
  | { kind: 'permission_denied';  reason: string }
  | { kind: 'validation_failed';  field: string; reason: string }
  | { kind: 'conflict';           reason: string }
  | { kind: 'internal';           message: string }
