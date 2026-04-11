// Browser server: web access. HTTP requests and page text extraction.
// Both tools run inside the session's sandbox container (bind-mounted at
// /work) so network egress goes through the same cgroup/policy as the rest
// of the agent's shell activity. No persistent state.
//
// Structure: handler functions are SDK-agnostic. buildSdk wraps them as
// Anthropic Claude Agent SDK tools. buildAi wraps them as Vercel ai SDK
// tools. Both runners consume the same handlers.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import * as validate from '../validate.js'
import { toInt } from '../functional.js'
import { asText, bounded, boundedOutput, esc, runCommand } from './_shared.js'

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'browser',
  name:        'Browser',
  description: 'Web access: HTTP requests and page text extraction.',
  tools: [
    { name: 'fetch',  description: 'Make an HTTP request (GET/POST/etc.) and return the body.' },
    { name: 'scrape', description: 'Fetch a web page and return extracted text.' },
  ],
}

export interface BrowserCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
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
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'fetch', args, true)
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
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'scrape', args, true)
    return bounded(ctx.workspace, r.stdout.trim())
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

const DESC = {
  fetch:  'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',
  scrape: 'Extract clean readable text from a web page. Large output is written to a file you can read with offset/limit.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: BrowserCtx) {
  return createSdkMcpServer({
    name: 'browser',
    tools: [
      sdkTool('fetch',  DESC.fetch,  validate.toolFetch.shape,  async a => asText(await handleFetch(ctx, a))),
      sdkTool('scrape', DESC.scrape, validate.toolScrape.shape, async a => asText(await handleScrape(ctx, a))),
    ],
  })
}

// ── Vercel ai SDK adapter ──

export function buildAi(ctx: BrowserCtx) {
  return {
    fetch: tool({
      description:  DESC.fetch,
      inputSchema:  validate.toolFetch,
      outputSchema: boundedOutput.extend({ status: z.number() }),
      execute:      (args: z.infer<typeof validate.toolFetch>) => handleFetch(ctx, args),
    }),
    scrape: tool({
      description:  DESC.scrape,
      inputSchema:  validate.toolScrape,
      outputSchema: boundedOutput,
      execute:      (args: z.infer<typeof validate.toolScrape>) => handleScrape(ctx, args),
    }),
  }
}
