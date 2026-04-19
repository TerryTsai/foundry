import { z } from 'zod'

export const verdictSet = z.object({
  pass:   z.boolean(),
  reason: z.string(),
})
