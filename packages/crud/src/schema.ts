// Zod validators for crud entity inputs. One namespace per entity so call
// sites read as `validate.project.create.parse(input)` etc. The schemas
// live next to the entity logic — they're the boundary contract for HTTP
// callers and are versioned alongside the service functions that use them.

import { z } from 'zod'

// ── project ──────────────────────────────────────────────────────────

const repoSpec = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be "owner/name"')

export const project = {
  list: z.object({
    status: z.string().optional(),
  }),
  create: z.object({
    name:        z.string().min(1),
    description: z.string().optional(),
    repo:        repoSpec,
    max_agents:  z.number().int().positive().optional(),
  }),
  update: z.object({
    name:        z.string().min(1).optional(),
    description: z.string().optional(),
    repo:        repoSpec.optional(),
    status:      z.enum(['active', 'archived']).optional(),
    max_agents:  z.number().int().positive().optional(),
  }),
}

// ── ticket ───────────────────────────────────────────────────────────

export const ticket = {
  list: z.object({
    projectId: z.string().optional(),
    agentId:   z.string().optional(),
    status:    z.enum(['created', 'waiting', 'running', 'finished', 'failed', 'cancelled']).optional(),
    tag:       z.string().optional(),
  }),
  create: z.object({
    project_id:  z.string(),
    agent_id:    z.string().optional(),
    title:       z.string(),
    description: z.string(),
    depends_on:  z.string().optional(),
    created_by:  z.string(),
  }),
  update: z.object({
    title:       z.string().optional(),
    description: z.string().optional(),
    agent_id:    z.string().optional(),
  }),
  tagCreate: z.object({
    tag: z.string().min(1).max(50).transform(s => s.toLowerCase().trim()),
  }),
  commentCreate: z.object({
    author: z.string(),
    body:   z.string(),
  }),
}

// ── session ──────────────────────────────────────────────────────────

export const session = {
  verdictSet: z.object({
    pass:   z.boolean(),
    reason: z.string(),
  }),
}

// ── agent ────────────────────────────────────────────────────────────

const modelId = z.string().min(1).refine(s => !s.includes(':'), {
  message: 'model must be just the model id, no connection prefix (use connection_id to select the backend)',
})

const toolSelection = z.union([
  z.array(z.string()),
  z.record(z.string(), z.union([z.literal('*'), z.array(z.string())])),
])

export const agent = {
  list: z.object({
    accountId: z.string().optional(),
  }),
  create: z.object({
    connection_id:    z.string().min(1),
    name:             z.string().min(1),
    model:            modelId,
    description:      z.string().min(1),
    max_tokens:       z.number().int().positive().optional(),
    max_steps:        z.number().int().positive().optional(),
    temperature:      z.number().min(0).max(2).optional(),
    reasoning_budget: z.number().int().positive().nullable().optional(),
    tools:            toolSelection.optional(),
    verifiers:        z.array(z.string()).optional(),
  }),
  // agentUpdate is the "create a new version" shape: the service layer treats
  // every update as an insert with a new id; the prior row's superseded_at
  // is set to the new row's created_at. There's no in-place mutation.
  update: z.object({
    connection_id:    z.string().min(1).optional(),
    model:            modelId.optional(),
    description:      z.string().min(1).optional(),
    max_tokens:       z.number().int().positive().optional(),
    max_steps:        z.number().int().positive().optional(),
    temperature:      z.number().min(0).max(2).nullable().optional(),
    reasoning_budget: z.number().int().positive().nullable().optional(),
    tools:            toolSelection.optional(),
    verifiers:        z.array(z.string()).nullable().optional(),
  }),
}

// ── connection ───────────────────────────────────────────────────────

// `config` and `secrets` are free-form JSON blobs whose shape is interpreted
// by the kind-specific resolver at session start. The validator only enforces
// top-level shape; kind-specific validation happens in the provider modules.
export const connection = {
  list: z.object({
    accountId: z.string().optional(),
  }),
  create: z.object({
    kind:    z.string().min(1),
    name:    z.string().min(1),
    config:  z.record(z.string(), z.unknown()).optional(),
    secrets: z.record(z.string(), z.unknown()).optional(),
  }),
  update: z.object({
    name:    z.string().min(1).optional(),
    config:  z.record(z.string(), z.unknown()).optional(),
    secrets: z.record(z.string(), z.unknown()).optional(),
  }),
}

// ── Internal types ──────────────────────────────────────────────────
// All inline interfaces previously declared in crud feature files
// (attachment, execution, session, ticket, repo) consolidated here per
// the schema.ts standard.

import type { Attachment } from '@foundry/db'

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

export interface ExecutionInsertInput {
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
// Crud's encryptSecret / decryptSecret take the encryption key as a
// parameter. Server creates closures that bind the key once at boot and
// threads them through into the connection-management functions and
// the EngineDeps callback bag.

export type EncryptSecret = (plain: string) => string
export type DecryptSecret = (stored: string) => string

export interface CryptoOps {
  encryptSecret: EncryptSecret
  decryptSecret: DecryptSecret
}

// ── Connection types ────────────────────────────────────────────────
// Per-row provider metadata + the masked shape returned by routes (so
// secrets never serialize directly). Concrete providers live in mcp;
// crud only needs the structural shape to mask credential previews.

import type { Connection } from '@foundry/db'

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

export type ProviderGet      = (kind: string) => ConnectionProviderSpec | undefined
export type SupportedKindsFn = () => string[]

export interface EventCreateInput {
  entity_type:    string
  entity_id:      string
  kind:           string
  data?:          string
  caused_by:      string
  caused_by_id?:  string | null
}
