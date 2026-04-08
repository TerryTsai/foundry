import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { execFileSync } from 'child_process'
import { nanoid } from 'nanoid'
import type { Db } from './database.js'
import type { Config } from './config.js'
import * as v from './validate.js'
import domain from './domain.js'

export const TOOL_NAMES = ['exec', 'read', 'write', 'patch', 'search', 'find', 'fetch', 'scrape', 'think', 'ticket', 'agents'] as const
export type ToolName = typeof TOOL_NAMES[number]

const BOUNDED_THRESHOLD = 10_240 // 10 KB

const boundedOutput = z.object({
  content: z.string(),
  outputFile: z.string().optional(),
  totalLines: z.number().optional(),
  totalBytes: z.number().optional(),
  error: z.string().optional(),
})

export const makeTools = (db: Db, config: Config, sessionId: string, projectId: string, ticketId: string, agentName: string, workspace: string, enabledTools?: string[]) => {
  const all = _makeAllTools(db, config, sessionId, projectId, ticketId, agentName, workspace)
  if (!enabledTools || enabledTools.length === 0) return all
  const allRec = all as Record<string, (typeof all)[keyof typeof all]>
  const filtered: typeof allRec = {}
  for (const name of enabledTools) {
    if (name in allRec) filtered[name] = allRec[name]
  }
  return filtered
}

const _makeAllTools = (db: Db, config: Config, sessionId: string, projectId: string, ticketId: string, agentName: string, workspace: string) => {
  const api = `http://host.containers.internal:${config.port}`

  function bounded(raw: string): { content: string; outputFile?: string; totalLines?: number; totalBytes?: number } {
    const bytes = Buffer.byteLength(raw, 'utf-8')
    if (bytes <= BOUNDED_THRESHOLD) return { content: raw }

    const outputDir = join(workspace, '.foundry', 'output')
    mkdirSync(outputDir, { recursive: true })
    const filename = `${nanoid(12)}.txt`
    writeFileSync(join(outputDir, filename), raw, 'utf-8')

    const lines = raw.split('\n')
    const preview = lines.slice(0, 20).join('\n')
    return {
      content: preview,
      outputFile: `.foundry/output/${filename}`,
      totalLines: lines.length,
      totalBytes: bytes,
    }
  }

  function runApi(command: string, toolName: string): Promise<{ content: string; outputFile?: string; totalLines?: number; totalBytes?: number; error?: string }> {
    try {
      const { emitter } = domain.execution.create(db, config)({
        command, session_id: sessionId, tool_name: toolName, network: true, workspace,
      })
      const stdout: string[] = []
      return new Promise(resolve => {
        emitter.on('stdout', (line: string) => stdout.push(line))
        emitter.once('exit', (code: number) => {
          if (code === 0) {
            resolve(bounded(stdout.join('\n')))
          } else {
            resolve({ content: '', error: `request failed (exit ${code})` })
          }
        })
      })
    } catch (err) {
      return Promise.resolve({ content: '', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return ({

  exec: tool({
    description: 'Run a shell command in a sandboxed container with the project repo at /work. Large stdout is written to a file; use the read tool to paginate.',
    inputSchema: v.tool.exec,
    outputSchema: boundedOutput.extend({ stderr: z.string(), exitCode: z.number() }),
    execute: async (args) => {
      const command = args.cwd ? `cd ${args.cwd} && ${args.command}` : args.command
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, tool_name: 'exec', network: args.network ?? false, workspace,
        })
        const stdout: string[] = []
        const stderr: string[] = []
        return await new Promise<{ content: string; outputFile?: string; totalLines?: number; totalBytes?: number; stderr: string; exitCode: number }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.on('stderr', (line: string) => stderr.push(line))
          emitter.once('exit', (code: number) => {
            resolve({ ...bounded(stdout.join('\n')), stderr: stderr.join('\n'), exitCode: code })
          })
        })
      } catch (err) {
        return { content: '', stderr: '', exitCode: -1, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  read: tool({
    description: 'Read the contents of a file from the workspace. Returns up to 500 lines by default. Use offset and limit to paginate through larger files.',
    inputSchema: v.tool.read,
    outputSchema: z.object({
      content: z.string(),
      truncated: z.boolean().optional(),
      totalLines: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      try {
        const fullPath = join(workspace, args.path)
        const content = readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        const start = args.offset ?? 0
        const limit = Math.min(args.limit ?? 500, 500)
        const end = start + limit
        const truncated = end < lines.length
        return {
          content: lines.slice(start, end).join('\n'),
          ...(truncated ? { truncated: true, totalLines: lines.length } : {}),
        }
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
    description: 'Search file contents using grep with regex support. Large results are written to a file; use the read tool to paginate.',
    inputSchema: v.tool.search,
    outputSchema: boundedOutput,
    execute: async (args) => {
      try {
        const searchPath = args.path ? join(workspace, args.path) : workspace
        const grepArgs = ['-rn', '--color=never']
        if (!args.no_exclude) grepArgs.push('--exclude-dir=.git', '--exclude-dir=node_modules', '--exclude-dir=__pycache__', '--exclude-dir=.venv', '--exclude-dir=.foundry')
        if (args.glob) grepArgs.push('--include', args.glob)
        grepArgs.push(args.pattern, searchPath)
        const result = execFileSync('grep', grepArgs, { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
        return bounded(result.replaceAll(workspace + '/', '').trimEnd())
      } catch (err: any) {
        if (err.status === 1) return { content: '' } // no matches
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  find: tool({
    description: 'List files matching a glob pattern in the workspace. Large results are written to a file; use the read tool to paginate.',
    inputSchema: v.tool.find,
    outputSchema: boundedOutput,
    execute: async (args) => {
      const depth = args.max_depth ?? 3
      try {
        const searchPath = args.path ? join(workspace, args.path) : workspace
        const findArgs = [searchPath, '-maxdepth', String(depth)]
        if (!args.no_exclude) findArgs.push('(', '-name', '.git', '-o', '-name', 'node_modules', '-o', '-name', '__pycache__', '-o', '-name', '.venv', '-o', '-name', '.foundry', ')', '-prune', '-o')
        findArgs.push('-type', 'f', '-name', args.pattern, '-print')
        const result = execFileSync('find', findArgs, {
          encoding: 'utf-8', maxBuffer: 1024 * 1024,
        })
        return bounded(result.replaceAll(workspace + '/', '').trim())
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  fetch: tool({
    description: 'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',
    inputSchema: v.tool.fetch,
    outputSchema: boundedOutput.extend({ status: z.number() }),
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
        return await new Promise<{ content: string; outputFile?: string; totalLines?: number; totalBytes?: number; status: number }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.once('exit', () => {
            const lines = stdout.join('\n').trimEnd().split('\n')
            const statusCode = parseInt(lines.pop() ?? '0', 10)
            resolve({ ...bounded(lines.join('\n')), status: statusCode })
          })
        })
      } catch (err) {
        return { content: '', status: 0, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  scrape: tool({
    description: 'Extract clean readable text from a web page, stripping navigation, ads, and markup. Large output is written to a file; use the read tool to paginate.',
    inputSchema: v.tool.scrape,
    outputSchema: boundedOutput,
    execute: async (args) => {
      const command = `lynx -dump -nolist -width=120 '${args.url.replace(/'/g, "'\\''")}'` +
        ` 2>/dev/null || curl -sL '${args.url.replace(/'/g, "'\\''")}'` +
        ` | sed 's/<[^>]*>//g' | sed '/^$/d' | head -500`
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, tool_name: 'scrape', network: true, workspace,
        })
        const stdout: string[] = []
        return await new Promise<{ content: string; outputFile?: string; totalLines?: number; totalBytes?: number }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.once('exit', () => {
            resolve(bounded(stdout.join('\n').trim()))
          })
        })
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  think: tool({
    description: 'Use this tool to reason, plan, or analyze before taking action. No side effects.',
    inputSchema: v.tool.think,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  }),

  agents: tool({
    description: 'List all agents in the current project. Useful for targeting sub-tickets at a specific agent.',
    inputSchema: z.object({}),
    outputSchema: boundedOutput,
    execute: async () => {
      const command = `curl -sf '${api}/agent?projectId=${projectId}'`
      return runApi(command, 'agents')
    },
  }),

  ticket: tool({
    description: 'Create, read, or list tickets in the current project. Use create to spawn sub-tasks, optionally assigning to an agent by ID. Use the agents tool first to discover agent IDs.',
    inputSchema: v.tool.ticket,
    outputSchema: boundedOutput,
    execute: async (args) => {
      let command: string
      if (args.action === 'read') {
        if (!args.id) return { content: '', error: 'id is required for read' }
        command = `curl -sf '${api}/ticket/${args.id}'`
      } else if (args.action === 'list') {
        command = `curl -sf '${api}/ticket?projectId=${projectId}'`
      } else if (args.action === 'create') {
        if (!args.title || !args.body) return { content: '', error: 'title and body are required for create' }
        const payload = JSON.stringify({
          project_id: projectId, title: args.title, body: args.body,
          priority: 0, parent_id: ticketId, created_by: agentName,
          ...(args.agent_id ? { agent_id: args.agent_id } : {}),
        })
        command = `curl -sf -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' '${api}/ticket'`
      } else {
        return { content: '', error: 'unknown action' }
      }
      return runApi(command, 'ticket')
    },
  }),
})}
