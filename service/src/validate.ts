import { z } from 'zod'

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

const project = {
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

const provider = {
  create: z.object({
    name:    z.string().min(1),
    api_key: z.string().min(1),
  }),
  update: z.object({
    api_key: z.string().min(1),
  }),
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

const ticket = {
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

const comment = {
  create: z.object({
    author: z.string(),
    body:   z.string(),
  }),
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const modelString = z.string().min(1).refine(s => s.includes(':'), { message: 'model must be provider:model format' })

const agent = {
  list: z.object({
    projectId: z.string().optional(),
  }),
  create: z.object({
    project_id:       z.string(),
    name:             z.string().min(1),
    model:            modelString,
    prompt:           z.string().min(1),
    max_tokens:       z.number().int().positive().optional(),
    max_steps:        z.number().int().positive().optional(),
    temperature:      z.number().min(0).max(2).optional(),
    reasoning_budget: z.number().int().positive().nullable().optional(),
    tools:            z.array(z.string()).optional(),
  }),
  update: z.object({
    model:            modelString.optional(),
    prompt:           z.string().min(1).optional(),
    max_tokens:       z.number().int().positive().optional(),
    max_steps:        z.number().int().positive().optional(),
    temperature:      z.number().min(0).max(2).nullable().optional(),
    reasoning_budget: z.number().int().positive().nullable().optional(),
    tools:            z.array(z.string()).optional(),
  }),
}

const session = {
  start:   z.object({ ticket_id: z.string() }),
  message: z.object({ content: z.string().min(1) }),
}

const execution = {
  create: z.object({
    command:    z.string().min(1),
    session_id: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
    memory_mb:  z.number().int().positive().optional(),
    network:    z.boolean().optional(),
  }),
}

const tool = {
  exec: z.object({
    command: z.string().describe('Shell command to run'),
    cwd:     z.string().optional().describe('Working directory relative to /work (default: /work)'),
    network: z.boolean().optional().describe('Enable network access (default: false)'),
  }),
  read: z.object({
    path:   z.string().describe('File path relative to /work'),
    offset: z.number().int().min(0).optional().describe('Start reading from this line number (0-based)'),
    limit:  z.number().int().positive().max(500).optional().describe('Maximum number of lines to read (default: 500, max: 500)'),
  }),
  write: z.object({
    path:    z.string().describe('File path relative to /work'),
    content: z.string().describe('Full file content to write'),
  }),
  patch: z.object({
    path:       z.string().describe('File path relative to /work'),
    old_string: z.string().describe('Exact string to find in the file'),
    new_string: z.string().describe('Replacement string'),
  }),
  search: z.object({
    pattern:     z.string().describe('Regex pattern to search for'),
    path:        z.string().optional().describe('Directory or file to search in, relative to /work (default: /work)'),
    glob:        z.string().optional().describe('File glob filter (e.g. "*.ts")'),
    no_exclude:  z.boolean().optional().describe('Include .git, node_modules, etc. in search (default: false)'),
  }),
  find: z.object({
    pattern:     z.string().describe('Glob pattern to match file names (e.g. "**/*.ts")'),
    path:        z.string().optional().describe('Directory to search in, relative to /work (default: /work)'),
    max_depth:   z.number().int().positive().max(10).optional().describe('Maximum directory depth to search (default: 3, max: 10)'),
    no_exclude:  z.boolean().optional().describe('Include .git, node_modules, etc. in results (default: false)'),
  }),
  fetch: z.object({
    url:     z.string().describe('URL to fetch'),
    method:  z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP method (default: GET)'),
    headers: z.record(z.string()).optional().describe('HTTP headers'),
    body:    z.string().optional().describe('Request body'),
  }),
  scrape: z.object({
    url: z.string().describe('URL of web page to scrape'),
  }),
  think: z.object({
    thought: z.string().describe('Your reasoning, analysis, or planning notes'),
  }),
  ticket: z.object({
    action:   z.enum(['create', 'read', 'list']).describe('Action to perform'),
    id:       z.string().optional().describe('Ticket ID (required for read)'),
    title:    z.string().optional().describe('Ticket title (required for create)'),
    body:     z.string().optional().describe('Ticket body (required for create)'),
    agent_id: z.string().optional().describe('Agent ID to assign the ticket to (for create). Use the agents tool to get agent IDs.'),
  }),
}

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

const file = {
  write: z.object({
    content: z.string(),
    message: z.string().optional(),
  }),
}

// ════════════════════════════════════════════════════════════════════════════

const validate = { project, provider, ticket, comment, agent, session, execution, tool, file }
export default validate
