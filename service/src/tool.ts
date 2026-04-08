import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { execFileSync } from 'child_process'
import type { Db } from './database.js'
import type { Config } from './config.js'
import * as v from './validate.js'
import domain from './domain.js'

export const makeTools = (db: Db, config: Config, sessionId: string, projectId: string, ticketId: string, agentName: string, workspace: string) => ({

  exec: tool({
    description: 'Run a shell command in a sandboxed Podman container with the project repo at /work.',
    inputSchema: v.tool.exec,
    outputSchema: z.object({
      stdout: z.string(), stderr: z.string(), exitCode: z.number(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      const command = args.cwd ? `cd ${args.cwd} && ${args.command}` : args.command
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, tool_name: 'exec', network: args.network ?? false, workspace,
        })
        const stdout: string[] = []
        const stderr: string[] = []
        return await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.on('stderr', (line: string) => stderr.push(line))
          emitter.once('exit', (code: number) => {
            resolve({ stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: code })
          })
        })
      } catch (err) {
        return { stdout: '', stderr: '', exitCode: -1, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  read: tool({
    description: 'Read the contents of a file from the workspace.',
    inputSchema: v.tool.read,
    outputSchema: z.object({
      content: z.string(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const fullPath = join(workspace, args.path)
        const content = readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        const start = args.offset ?? 0
        const end = args.limit ? start + args.limit : lines.length
        return { content: lines.slice(start, end).join('\n') }
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  write: tool({
    description: 'Create or overwrite a file in the workspace.',
    inputSchema: v.tool.write,
    outputSchema: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const fullPath = join(workspace, args.path)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, args.content, 'utf-8')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  patch: tool({
    description: 'Apply a targeted edit to a file by replacing an exact string match.',
    inputSchema: v.tool.patch,
    outputSchema: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const fullPath = join(workspace, args.path)
        const content = readFileSync(fullPath, 'utf-8')
        if (!content.includes(args.old_string)) {
          return { ok: false, error: 'old_string not found in file' }
        }
        const updated = content.replace(args.old_string, args.new_string)
        writeFileSync(fullPath, updated, 'utf-8')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  search: tool({
    description: 'Search file contents using grep with regex support.',
    inputSchema: v.tool.search,
    outputSchema: z.object({
      matches: z.string(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const searchPath = args.path ? join(workspace, args.path) : workspace
        const grepArgs = ['-rn', '--color=never']
        if (args.glob) grepArgs.push('--include', args.glob)
        grepArgs.push(args.pattern, searchPath)
        const result = execFileSync('grep', grepArgs, { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
        // Strip workspace prefix from output for cleaner paths
        return { matches: result.replaceAll(workspace + '/', '') }
      } catch (err: any) {
        if (err.status === 1) return { matches: '' } // no matches
        return { matches: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  find: tool({
    description: 'List files matching a glob pattern in the workspace.',
    inputSchema: v.tool.find,
    outputSchema: z.object({
      files: z.string(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const searchPath = args.path ? join(workspace, args.path) : workspace
        const result = execFileSync('find', [searchPath, '-type', 'f', '-name', args.pattern], {
          encoding: 'utf-8', maxBuffer: 1024 * 1024,
        })
        return { files: result.replaceAll(workspace + '/', '').trim() }
      } catch (err) {
        return { files: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  fetch: tool({
    description: 'Make an HTTP request and return the response.',
    inputSchema: v.tool.fetch,
    outputSchema: z.object({
      status: z.number(), body: z.string(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      const curlArgs = ['-s', '-w', '\n%{http_code}', '-X', args.method ?? 'GET']
      if (args.headers) {
        for (const [k, val] of Object.entries(args.headers)) {
          curlArgs.push('-H', `${k}: ${val}`)
        }
      }
      if (args.body) curlArgs.push('-d', args.body)
      curlArgs.push(args.url)
      const command = `curl ${curlArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, tool_name: 'fetch', network: true, workspace,
        })
        const stdout: string[] = []
        const stderr: string[] = []
        return await new Promise<{ status: number; body: string }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.on('stderr', (line: string) => stderr.push(line))
          emitter.once('exit', () => {
            const lines = stdout.join('\n').trimEnd().split('\n')
            const statusCode = parseInt(lines.pop() ?? '0', 10)
            resolve({ status: statusCode, body: lines.join('\n') })
          })
        })
      } catch (err) {
        return { status: 0, body: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  scrape: tool({
    description: 'Extract clean readable text from a web page, stripping navigation, ads, and markup.',
    inputSchema: v.tool.scrape,
    outputSchema: z.object({
      text: z.string(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      // Use lynx -dump for clean text extraction; falls back to curl + sed
      const command = `lynx -dump -nolist -width=120 '${args.url.replace(/'/g, "'\\''")}'` +
        ` 2>/dev/null || curl -sL '${args.url.replace(/'/g, "'\\''")}'` +
        ` | sed 's/<[^>]*>//g' | sed '/^$/d' | head -500`
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, tool_name: 'scrape', network: true, workspace,
        })
        const stdout: string[] = []
        return await new Promise<{ text: string }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.once('exit', () => {
            resolve({ text: stdout.join('\n').trim() })
          })
        })
      } catch (err) {
        return { text: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  think: tool({
    description: 'Use this tool to reason, plan, or analyze before taking action. No side effects.',
    inputSchema: v.tool.think,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  }),
})
