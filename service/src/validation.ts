import { z } from 'zod'

// ── Tickets ──

export const createTicketBody = z.object({
  project_id: z.string(),
  title:      z.string(),
  body:       z.string(),
  agent:      z.string(),
  parent_id:  z.string().optional(),
  created_by: z.string(),
  block:      z.boolean().optional(),
})

export const updateTicketBody = z.object({
  body:  z.string().optional(),
  notes: z.string().optional(),
})

export const doneTicketBody = z.object({
  notes: z.string().optional(),
})

export const failTicketBody = z.object({
  notes: z.string().optional(),
})

export const listTicketsQuery = z.object({
  projectId: z.string().optional(),
  agent:     z.string().optional(),
  status:    z.string().optional(),
  parentId:  z.string().optional(),
})

// ── Projects ──

export const createProjectBody = z.object({
  name:               z.string().min(1),
  workspace:          z.string().min(1),
  schedule_interval:  z.number().int().positive().optional(),
  concurrency_limit:  z.number().int().positive().optional(),
})

export const updateProjectBody = z.object({
  name:               z.string().min(1).optional(),
  workspace:          z.string().min(1).optional(),
  status:             z.enum(['active', 'paused']).optional(),
  schedule_interval:  z.number().int().positive().optional(),
  concurrency_limit:  z.number().int().positive().optional(),
})

export const listProjectsQuery = z.object({
  status: z.string().optional(),
})

// ── Agent Definitions ──

export const createAgentDefBody = z.object({
  project_id: z.string(),
  name:       z.string().min(1),
  prompt:     z.string().min(1),
})

export const updateAgentDefBody = z.object({
  prompt: z.string().min(1).optional(),
})

export const listAgentDefsQuery = z.object({
  projectId: z.string().optional(),
})

// ── Sessions ──

export const startSessionBody = z.object({
  ticket_id: z.string(),
})

export const sendMessageBody = z.object({
  content: z.string().min(1),
})

// ── Sandbox ──

export const createSandboxBody = z.object({
  command:    z.string().min(1),
  workspace:  z.string().min(1),
  session_id: z.string().optional(),
  env:        z.record(z.string()).optional(),
  network:    z.boolean().optional(),
})

// ── Files ──

export const writeFileBody = z.object({
  content: z.string(),
  message: z.string().optional(),
})

// ── Tool Params ──

export const runCommandParams = z.object({
  command: z.string().describe('Shell command to run'),
  cwd:     z.string().optional().describe('Working directory relative to /work (default: /work)'),
  network: z.boolean().optional().describe('Enable network access (default: false)'),
})

export const createTicketParams = z.object({
  title: z.string().describe('Ticket title'),
  body:  z.string().describe('Ticket body in markdown'),
  agent: z.string().describe('Agent name that should handle this ticket'),
  block: z.boolean().describe('If true, suspend the current ticket until this child ticket is done'),
})
