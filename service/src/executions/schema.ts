import { z } from 'zod'

export const executionCreate = z.object({
  command:    z.string().min(1),
  session_id: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  memory_mb:  z.number().int().positive().optional(),
  network:    z.boolean().optional(),
})
