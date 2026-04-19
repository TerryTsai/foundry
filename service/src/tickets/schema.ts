import { z } from 'zod'

export const ticketList = z.object({
  projectId: z.string().optional(),
  agentId:   z.string().optional(),
  status:    z.enum(['created', 'waiting', 'running', 'finished', 'failed', 'cancelled']).optional(),
  tag:       z.string().optional(),
})

export const ticketCreate = z.object({
  project_id:  z.string(),
  agent_id:    z.string().optional(),
  title:       z.string(),
  description: z.string(),
  priority:    z.number().int().default(0),
  depends_on:  z.string().optional(),
  created_by:  z.string(),
})

export const ticketUpdate = z.object({
  title:       z.string().optional(),
  description: z.string().optional(),
  agent_id:    z.string().optional(),
  priority:    z.number().int().optional(),
})

export const tagCreate = z.object({
  tag: z.string().min(1).max(50).transform(s => s.toLowerCase().trim()),
})

export const commentCreate = z.object({
  author: z.string(),
  body:   z.string(),
})
