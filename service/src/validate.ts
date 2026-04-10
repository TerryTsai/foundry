import { z } from 'zod'

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

export const authCallback = z.object({
  code:  z.string().min(1),
  state: z.string().min(1),
})

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

export const projectList = z.object({
  status: z.string().optional(),
})

export const projectCreate = z.object({
  name:               z.string().min(1),
  schedule_interval:  z.number().int().positive().optional(),
  concurrency_limit:  z.number().int().positive().optional(),
})

export const projectUpdate = z.object({
  name:               z.string().min(1).optional(),
  status:             z.enum(['active', 'archived']).optional(),
  schedule_interval:  z.number().int().positive().optional(),
  concurrency_limit:  z.number().int().positive().optional(),
})

export const providerCreate = z.object({
  name:    z.string().min(1),
  type:    z.string().min(1),
  api_key: z.string().min(1),
})

export const providerUpdate = z.object({
  name:    z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
})

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export const ticketList = z.object({
  projectId: z.string().optional(),
  agentId:   z.string().optional(),
  status:    z.string().optional(),
  parentId:  z.string().optional(),
})

export const ticketCreate = z.object({
  project_id: z.string(),
  agent_id:   z.string().optional(),
  title:      z.string(),
  body:       z.string(),
  priority:   z.number().int().default(0),
  parent_id:  z.string().optional(),
  created_by: z.string(),
  block:      z.boolean().optional(),
})

export const ticketUpdate = z.object({
  title:    z.string().optional(),
  body:     z.string().optional(),
  agent_id: z.string().optional(),
  priority: z.number().int().optional(),
})

export const ticketDone = z.object({ notes: z.string().optional() })
export const ticketFail = z.object({ notes: z.string().optional() })

export const commentCreate = z.object({
  author: z.string(),
  body:   z.string(),
})

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const modelId = z.string().min(1).refine(s => !s.includes(':'), { message: 'model must be just the model id, no provider prefix (use provider_id to select the provider)' })

export const agentList = z.object({
  projectId: z.string().optional(),
})

export const agentCreate = z.object({
  project_id:       z.string(),
  provider_id:      z.string().min(1),
  name:             z.string().min(1),
  model:            modelId,
  prompt:           z.string().min(1),
  max_tokens:       z.number().int().positive().optional(),
  max_steps:        z.number().int().positive().optional(),
  temperature:      z.number().min(0).max(2).optional(),
  reasoning_budget: z.number().int().positive().nullable().optional(),
  tools:            z.array(z.string()).optional(),
})

export const agentUpdate = z.object({
  provider_id:      z.string().min(1).optional(),
  model:            modelId.optional(),
  prompt:           z.string().min(1).optional(),
  max_tokens:       z.number().int().positive().optional(),
  max_steps:        z.number().int().positive().optional(),
  temperature:      z.number().min(0).max(2).nullable().optional(),
  reasoning_budget: z.number().int().positive().nullable().optional(),
  tools:            z.array(z.string()).optional(),
})

export const sessionStart   = z.object({ ticket_id: z.string() })
export const sessionMessage = z.object({ content: z.string().min(1) })

export const executionCreate = z.object({
  command:    z.string().min(1),
  session_id: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  memory_mb:  z.number().int().positive().optional(),
  network:    z.boolean().optional(),
})

// ════════════════════════════════════════════════════════════════════════════
// TOOL
// ════════════════════════════════════════════════════════════════════════════

// Path conventions for file/dir tools (read, write, patch, search, find):
//   - Absolute path (starts with /): used as-is. Lets the agent reach /tmp,
//     /proc, /etc, or anywhere in the container that the sandbox allows.
//   - Relative path: rooted at /work (the project workspace bind-mount).
//   - Empty/omitted: defaults to /work for search/find.

export const toolExec = z.object({
  command: z.string().describe('Shell command to run'),
  cwd:     z.string().optional().describe('Working directory. Absolute or relative to /work. Default: /work'),
  network: z.boolean().optional().describe('Enable network access (default: false)'),
})

export const toolRead = z.object({
  path:   z.string().describe('File path. Absolute (e.g. /tmp/foo, /etc/os-release) or relative to /work (e.g. src/foo.ts)'),
  offset: z.number().int().min(0).optional().describe('Start reading from this line number (0-based). Use with limit to paginate large files.'),
  limit:  z.number().int().positive().optional().describe('Maximum number of lines to read. Omit to read entire file (large files are written to a tmp file you can re-read with offset/limit).'),
})

export const toolWrite = z.object({
  path:    z.string().describe('File path. Absolute or relative to /work'),
  content: z.string().describe('Full file content to write'),
})

export const toolPatch = z.object({
  path:       z.string().describe('File path. Absolute or relative to /work'),
  old_string: z.string().describe('Exact string to find in the file'),
  new_string: z.string().describe('Replacement string'),
})

export const toolSearch = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path:    z.string().optional().describe('Directory or file to search in. Absolute or relative to /work (default: /work)'),
  glob:    z.string().optional().describe('File glob filter (e.g. "*.ts")'),
})

export const toolFind = z.object({
  pattern:   z.string().describe('Glob pattern to match file names (e.g. "**/*.ts")'),
  path:      z.string().optional().describe('Directory to search in. Absolute or relative to /work (default: /work)'),
  max_depth: z.number().int().positive().optional().describe('Maximum directory depth (default: 3). Increase for deeper scans, but very deep scans may time out — narrow path or pattern if so.'),
})

export const toolFetch = z.object({
  url:     z.string().describe('URL to fetch'),
  method:  z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP method (default: GET)'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
  body:    z.string().optional().describe('Request body'),
})

export const toolScrape = z.object({
  url: z.string().describe('URL of web page to scrape'),
})

export const toolThink = z.object({
  thought: z.string().describe('Your reasoning, analysis, or planning notes'),
})

export const toolTicket = z.object({
  action:   z.enum(['create', 'read', 'list']).describe('Action to perform'),
  id:       z.string().optional().describe('Ticket ID (required for read)'),
  title:    z.string().optional().describe('Ticket title (required for create)'),
  body:     z.string().optional().describe('Ticket body (required for create)'),
  agent_id: z.string().optional().describe('Agent ID to assign the ticket to (for create). Use the agents tool to get agent IDs.'),
})

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

export const fileWrite = z.object({
  content: z.string(),
  message: z.string().optional(),
})
