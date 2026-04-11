// Browser server: web access. HTTP requests and page text extraction.
// Both tools run inside the session's sandbox container (bind-mounted at
// /work) so network egress goes through the same cgroup/policy as the rest
// of the agent's shell activity. No persistent state.
//
// Future additions might include a headless browser (puppeteer/playwright)
// as a `browse` tool for JS-rendered pages; v1 is just fetch + scrape.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import * as validate from '../validate.js'
import { toInt } from '../functional.js'
import { asText, bounded, esc, runCommand } from '../runtime/tool.js'

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

export function build(db: Db, config: Config, sessionId: string, workspace: string) {
  return createSdkMcpServer({
    name: 'browser',
    tools: [

      sdkTool(
        'fetch',
        'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',
        validate.toolFetch.shape,
        async (args) => {
          const curlArgs = ['-s', '-w', '\\n%{http_code}', '-X', args.method ?? 'GET']
          if (args.headers) {
            for (const [k, val] of Object.entries(args.headers)) curlArgs.push('-H', `${k}: ${val}`)
          }
          if (args.body) curlArgs.push('-d', args.body)
          curlArgs.push(args.url)
          const command = `curl ${curlArgs.map(a => esc(a)).join(' ')}`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'fetch', args, true)
            const lines = r.stdout.trimEnd().split('\n')
            const statusCode = toInt(lines.pop() ?? '0')
            return asText({ ...bounded(workspace, lines.join('\n')), status: statusCode })
          } catch (err) {
            return asText({ status: 0, error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'scrape',
        'Extract clean readable text from a web page. Large output is written to a file you can read with offset/limit.',
        validate.toolScrape.shape,
        async (args) => {
          const url = esc(args.url)
          const command = `lynx -dump -nolist -width=120 ${url} 2>/dev/null || curl -sL ${url} | sed 's/<[^>]*>//g' | sed '/^$/d'`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'scrape', args, true)
            return asText(bounded(workspace, r.stdout.trim()))
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

    ],
  })
}
