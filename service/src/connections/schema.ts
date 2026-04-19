import { z } from 'zod'

// Connection (generalized provider + integration).
// `config` and `secrets` are free-form JSON blobs whose shape is interpreted
// by the kind-specific resolver at session start. The validator only enforces
// top-level shape; kind-specific validation happens in the provider modules.

export const connectionList = z.object({
  accountId: z.string().optional(),
})

export const connectionCreate = z.object({
  kind:    z.string().min(1),
  name:    z.string().min(1),
  config:  z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.unknown()).optional(),
})

export const connectionUpdate = z.object({
  name:    z.string().min(1).optional(),
  config:  z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.unknown()).optional(),
})
