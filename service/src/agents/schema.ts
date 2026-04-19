import { z } from 'zod'

const modelId = z.string().min(1).refine(s => !s.includes(':'), {
  message: 'model must be just the model id, no connection prefix (use connection_id to select the backend)',
})

const toolSelection = z.union([
  z.array(z.string()),
  z.record(z.string(), z.union([z.literal('*'), z.array(z.string())])),
])

export const agentList = z.object({
  accountId: z.string().optional(),
})

export const agentCreate = z.object({
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
})

// agentUpdate is the "create a new version" shape: the service layer treats
// every update as an insert with a new id; the prior row's superseded_at
// is set to the new row's created_at. There's no in-place mutation.
export const agentUpdate = z.object({
  connection_id:    z.string().min(1).optional(),
  model:            modelId.optional(),
  description:      z.string().min(1).optional(),
  max_tokens:       z.number().int().positive().optional(),
  max_steps:        z.number().int().positive().optional(),
  temperature:      z.number().min(0).max(2).nullable().optional(),
  reasoning_budget: z.number().int().positive().nullable().optional(),
  tools:            toolSelection.optional(),
  verifiers:        z.array(z.string()).nullable().optional(),
})
