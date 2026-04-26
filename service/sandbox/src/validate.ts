// Boundary validators for @foundry/sandbox. Zod schemas live here (and
// only here) so schema.ts and client.ts stay free of the zod runtime —
// type-only consumers don't drag the validator in.

import { z } from 'zod'

export const executionCreate = z.object({
  command:    z.string().min(1),
  session_id: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
})
export type ExecutionCreateBody = z.infer<typeof executionCreate>
