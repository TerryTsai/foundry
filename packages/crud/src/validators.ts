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
