import { z } from 'zod'

// Schemas for the sandbox MCP tools (run/read/write/patch/search/find/
// fetch/scrape). Lives next to the handlers in sandbox.ts.
//
// Path conventions for file/dir tools:
//   - Absolute path (starts with /): used as-is. Lets the agent reach /tmp,
//     /proc, /etc, or anywhere in the container that the sandbox allows.
//   - Relative path: rooted at /home/foundry (the project workspace bind-mount).
//   - Empty/omitted: defaults to /home/foundry for search/find.

export const toolExec = z.object({
  command: z.string().describe('Shell command to run'),
  cwd:     z.string().optional().describe('Working directory. Absolute or relative to /home/foundry. Default: /home/foundry'),
})

export const toolRead = z.object({
  path:   z.string().describe('File path. Absolute (e.g. /tmp/foo, /etc/os-release) or relative to /home/foundry (e.g. src/foo.ts)'),
  offset: z.number().int().min(0).optional().describe('Start reading from this line number (0-based). Use with limit to paginate large files.'),
  limit:  z.number().int().positive().optional().describe('Maximum number of lines to read. Omit to read entire file (large files are written to a tmp file you can re-read with offset/limit).'),
})

export const toolWrite = z.object({
  path:    z.string().describe('File path. Absolute or relative to /home/foundry'),
  content: z.string().describe('Full file content to write'),
})

export const toolPatch = z.object({
  path:       z.string().describe('File path. Absolute or relative to /home/foundry'),
  old_string: z.string().describe('Exact string to find in the file'),
  new_string: z.string().describe('Replacement string'),
})

export const toolSearch = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path:    z.string().optional().describe('Directory or file to search in. Absolute or relative to /home/foundry (default: /home/foundry)'),
  glob:    z.string().optional().describe('File glob filter (e.g. "*.ts")'),
})

export const toolFind = z.object({
  pattern:   z.string().describe('Glob pattern to match file names (e.g. "**/*.ts")'),
  path:      z.string().optional().describe('Directory to search in. Absolute or relative to /home/foundry (default: /home/foundry)'),
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
