import { z } from 'zod'

export const analytics = z.object({
  days:      z.coerce.number().int().min(1).max(365).default(30),
  projectId: z.string().optional(),   // narrow to a single project (must be owned by the account)
  agentId:   z.string().optional(),   // narrow sessions by agent
  tag:       z.string().optional(),   // narrow tickets (and the sessions/tools rolled up from them) to a single tag
})
