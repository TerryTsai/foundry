import { z } from 'zod'

// ── Tickets ──

export const ticket = {
  list: z.object({
    projectId: z.string().optional(),
    agentId:   z.string().optional(),
    status:    z.string().optional(),
    parentId:  z.string().optional(),
  }),
  create: z.object({
    project_id: z.string(),
    agent_id:   z.string().optional(),
    title:      z.string(),
    body:       z.string(),
    priority:   z.number().int().default(0),
    parent_id:  z.string().optional(),
    created_by: z.string(),
    block:      z.boolean().optional(),
  }),
  update: z.object({
    title:    z.string().optional(),
    body:     z.string().optional(),
    agent_id: z.string().optional(),
    priority: z.number().int().optional(),
  }),
  done: z.object({ notes: z.string().optional() }),
  fail: z.object({ notes: z.string().optional() }),
}

// ── Comments ──

export const comment = {
  create: z.object({
    author: z.string(),
    body:   z.string(),
  }),
}

// ── Projects ──

export const project = {
  list: z.object({
    status: z.string().optional(),
  }),
  create: z.object({
    name:               z.string().min(1),
    schedule_interval:  z.number().int().positive().optional(),
    concurrency_limit:  z.number().int().positive().optional(),
  }),
  update: z.object({
    name:               z.string().min(1).optional(),
    status:             z.enum(['active', 'archived']).optional(),
    schedule_interval:  z.number().int().positive().optional(),
    concurrency_limit:  z.number().int().positive().optional(),
  }),
}

// ── Agents ──

export const agent = {
  list: z.object({
    projectId: z.string().optional(),
  }),
  create: z.object({
    project_id:  z.string(),
    name:        z.string().min(1),
    model:       z.string().min(1),
    prompt:      z.string().min(1),
    max_tokens:  z.number().int().positive().optional(),
    max_steps:   z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }),
  update: z.object({
    model:       z.string().min(1).optional(),
    prompt:      z.string().min(1).optional(),
    max_tokens:  z.number().int().positive().optional(),
    max_steps:   z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
  }),
}

// ── Sessions ──

export const session = {
  start:   z.object({ ticket_id: z.string() }),
  message: z.object({ content: z.string().min(1) }),
}

// ── Executions ──

export const execution = {
  create: z.object({
    command:    z.string().min(1),
    session_id: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
    memory_mb:  z.number().int().positive().optional(),
    network:    z.boolean().optional(),
  }),
}

// ── Files ──

export const file = {
  write: z.object({
    content: z.string(),
    message: z.string().optional(),
  }),
}

// ── Tool Params ──

export const tool = {
  runCommand: z.object({
    command: z.string().describe('Shell command to run'),
    cwd:     z.string().optional().describe('Working directory relative to /work (default: /work)'),
    network: z.boolean().optional().describe('Enable network access (default: false)'),
  }),
  createTicket: z.object({
    title: z.string().describe('Ticket title'),
    body:  z.string().describe('Ticket body in markdown'),
    agent: z.string().describe('Agent name that should handle this ticket'),
    block: z.boolean().describe('If true, suspend the current ticket until this child ticket is done'),
  }),
}
