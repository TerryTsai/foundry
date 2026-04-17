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

const repoSpec = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be "owner/name"')

export const projectCreate = z.object({
  name:               z.string().min(1),
  description:        z.string().optional(),
  repo:               repoSpec,
  max_agents:         z.number().int().positive().optional(),
})

export const projectUpdate = z.object({
  name:               z.string().min(1).optional(),
  description:        z.string().optional(),
  repo:               repoSpec.optional(),
  status:             z.enum(['active', 'archived']).optional(),
  max_agents:         z.number().int().positive().optional(),
})

export const analytics = z.object({
  days:      z.coerce.number().int().min(1).max(365).default(30),
  projectId: z.string().optional(),   // narrow to a single project (must be owned by the account)
  agentId:   z.string().optional(),   // narrow sessions by agent
})

// Connection (generalized provider + integration).
// `config` and `secrets` are free-form JSON blobs whose shape is interpreted
// by the kind-specific resolver at session start. The validator only enforces
// top-level shape; kind-specific validation happens in kind modules.
export const connectionList = z.object({
  accountId: z.string().optional(),
})

export const connectionCreate = z.object({
  kind:       z.string().min(1),
  name:       z.string().min(1),
  config:     z.record(z.string(), z.unknown()).optional(),
  secrets:    z.record(z.string(), z.unknown()).optional(),
})

export const connectionUpdate = z.object({
  name:    z.string().min(1).optional(),
  config:  z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.unknown()).optional(),
})

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export const ticketList = z.object({
  projectId: z.string().optional(),
  agentId:   z.string().optional(),
  status:    z.enum(['created', 'waiting', 'running', 'finished', 'failed', 'cancelled']).optional(),
  tag:       z.string().optional(),
})

export const tagCreate = z.object({
  tag: z.string().min(1).max(50).transform(s => s.toLowerCase().trim()),
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


export const commentCreate = z.object({
  author: z.string(),
  body:   z.string(),
})

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const modelId = z.string().min(1).refine(s => !s.includes(':'), { message: 'model must be just the model id, no connection prefix (use connection_id to select the backend)' })

const toolSelection = z.union([
  z.array(z.string()),
  z.record(z.string(), z.union([z.literal('*'), z.array(z.string())])),
])

export const agentList = z.object({
  accountId: z.string().optional(),
})

export const agentCreate = z.object({
  connection_id:    z.string().min(1),
  name:             z.string().min(1),
  model:            modelId,
  description:      z.string().min(1),
  max_tokens:       z.number().int().positive().optional(),
  max_steps:        z.number().int().positive().optional(),
  temperature:      z.number().min(0).max(2).optional(),
  reasoning_budget: z.number().int().positive().nullable().optional(),
  tools:            toolSelection.optional(),
  verifiers:        z.array(z.string()).optional(),
})

// agentUpdate is the "create a new version" shape: the domain layer treats
// every update as an insert with a new id; the prior row's superseded_at
// is set to the new row's created_at. There's no in-place mutation.
export const agentUpdate = z.object({
  connection_id:    z.string().min(1).optional(),
  model:            modelId.optional(),
  description:      z.string().min(1).optional(),
  max_tokens:       z.number().int().positive().optional(),
  max_steps:        z.number().int().positive().optional(),
  temperature:      z.number().min(0).max(2).nullable().optional(),
  reasoning_budget: z.number().int().positive().nullable().optional(),
  tools:            toolSelection.optional(),
  verifiers:        z.array(z.string()).nullable().optional(),
})

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


