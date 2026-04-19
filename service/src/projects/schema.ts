import { z } from 'zod'

const repoSpec = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be "owner/name"')

export const projectList = z.object({
  status: z.string().optional(),
})

export const projectCreate = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  repo:        repoSpec,
  max_agents:  z.number().int().positive().optional(),
})

export const projectUpdate = z.object({
  name:        z.string().min(1).optional(),
  description: z.string().optional(),
  repo:        repoSpec.optional(),
  status:      z.enum(['active', 'archived']).optional(),
  max_agents:  z.number().int().positive().optional(),
})
