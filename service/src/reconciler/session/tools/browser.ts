// Browser server: web access. HTTP requests and page text extraction.
// Both tools run inside the session's sandbox container (bind-mounted at
// /work) so network egress goes through the same cgroup/policy as the rest
// of the agent's shell activity. No persistent state.

import { z } from 'zod'

import type { Db } from '../../../core/db.js'
import type { Config } from '../../../core/config.js'
import * as validate from './sandbox-schema.js'
import { toInt } from '../../../core/util.js'
import { bounded, esc, runCommand } from '../../../integrations/shared.js'

import type { } from './registry.js'
import type { McpServerInfo, ToolDef } from '../../../integrations/types.js'

export interface BrowserCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
  toolUseId?: string
}

// ── Handlers ──

async function handleFetch(ctx: BrowserCtx, args: z.infer<typeof validate.toolFetch>) {
  const curlArgs = ['-s', '-w', '\\n%{http_code}', '-X', args.method ?? 'GET']
  if (args.headers) {
    for (const [k, val] of Object.entries(args.headers)) curlArgs.push('-H', `${k}: ${val}`)
  }
  if (args.body) curlArgs.push('-d', args.body)
  curlArgs.push(args.url)
  const command = `curl ${curlArgs.map(a => esc(a)).join(' ')}`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'fetch', args, { network: true, toolUseId: ctx.toolUseId })
    const lines = r.stdout.trimEnd().split('\n')
    const statusCode = toInt(lines.pop() ?? '0')
    return { ...bounded(ctx.workspace, lines.join('\n')), status: statusCode }
  } catch (err) {
    return { content: '', status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleScrape(ctx: BrowserCtx, args: z.infer<typeof validate.toolScrape>) {
  const url = esc(args.url)
  const command = `lynx -dump -nolist -width=120 ${url} 2>/dev/null || curl -sL ${url} | sed 's/<[^>]*>//g' | sed '/^$/d'`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'scrape', args, { network: true, toolUseId: ctx.toolUseId })
    return bounded(ctx.workspace, r.stdout.trim())
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'browser',
  name:        'Browser',
  category:    'core',
  description: 'Web access: HTTP requests and page text extraction.',
}

export const tools: ToolDef[] = [
  { name: 'fetch',  description: 'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.', schema: validate.toolFetch,  handler: handleFetch },
  { name: 'scrape', description: 'Extract clean readable text from a web page. Large output is written to a file you can read with offset/limit.',     schema: validate.toolScrape, handler: handleScrape },
]
