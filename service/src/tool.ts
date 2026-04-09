import { tool } from 'ai'
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { nanoid } from 'nanoid'
import type { Db } from './database.js'
import type { Config } from './config.js'
import validate from './validate.js'
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

// ── Helpers ──

function esc(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
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

  function run(command: string, toolName: string, network = false): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { emitter } = domain.execution.create(db, config)({
      command, session_id: sessionId, tool_name: toolName, network, workspace,
    })
    const stdout: string[] = []
    const stderr: string[] = []
    return new Promise(resolve => {
      emitter.on('stdout', (line: string) => stdout.push(line))
      emitter.on('stderr', (line: string) => stderr.push(line))
      emitter.once('exit', (code: number) => {
        resolve({ stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: code })
      })
    })
  }

  function runApi(command: string, toolName: string): Promise<{ content: string; outputFile?: string; totalLines?: number; totalBytes?: number; error?: string }> {
    return run(command, toolName, true).then(r => {
      if (r.exitCode === 0) return bounded(r.stdout)
      return { content: '', error: `request failed (exit ${r.exitCode})` }
    }).catch(err => ({ content: '', error: err instanceof Error ? err.message : String(err) }))
  }

  /** Write a temp file into the workspace (visible to container via bind mount). */
  function writeTmp(content: string, ext = 'txt'): string {
    const relPath = `.foundry/.tmp/${nanoid(8)}.${ext}`
    const absPath = join(workspace, relPath)
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, content, 'utf-8')
    return relPath
  }

  return ({

  // ── exec ──

  exec: tool({
    description: 'Run a shell command in a sandboxed container with the project repo at /work. Large stdout is written to a file; use the read tool to paginate.',
    inputSchema: validate.tool.exec,
    outputSchema: boundedOutput.extend({ stderr: z.string(), exitCode: z.number() }),
    execute: async (args) => {
      const command = args.cwd ? `cd ${esc(args.cwd)} && ${args.command}` : args.command
      try {
        const r = await run(command, 'exec', args.network ?? false)
        return { ...bounded(r.stdout), stderr: r.stderr, exitCode: r.exitCode }
      } catch (err) {
        return { content: '', stderr: '', exitCode: -1, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── read (pager — does NOT go through bounded) ──

  read: tool({
    description: 'Read the contents of a file from the workspace. Returns up to 500 lines. Use offset and limit to paginate larger files.',
    inputSchema: validate.tool.read,
    outputSchema: z.object({
      content: z.string(),
      truncated: z.boolean().optional(),
      totalLines: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      const limit = Math.min(args.limit ?? 500, 500)
      const start = args.offset ?? 0
      // First line of stdout = total line count, rest = file content
      const path = esc(`/work/${args.path}`)
      const command = `total=$(wc -l < ${path}) && echo "$total" && sed -n '${start + 1},${start + limit}p' ${path}`
      try {
        const r = await run(command, 'read')
        if (r.exitCode !== 0) return { content: '', error: r.stderr || 'file not found or unreadable' }
        const lines = r.stdout.split('\n')
        const totalLines = parseInt(lines[0], 10)
        const content = lines.slice(1).join('\n')
        const truncated = (start + limit) < totalLines
        return { content, ...(truncated ? { truncated: true, totalLines } : {}) }
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── write ──

  write: tool({
    description: 'Create or overwrite a file in the workspace.',
    inputSchema: validate.tool.write,
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
    execute: async (args) => {
      const tmpRel = writeTmp(args.content)
      const dest = esc(`/work/${args.path}`)
      const command = `mkdir -p "$(dirname ${dest})" && mv /work/${esc(tmpRel)} ${dest}`
      try {
        const r = await run(command, 'write')
        return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || 'write failed' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── patch ──

  patch: tool({
    description: 'Apply a targeted edit to a file by replacing an exact string match.',
    inputSchema: validate.tool.patch,
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
    execute: async (args) => {
      const meta = writeTmp(JSON.stringify({
        path: `/work/${args.path}`,
        old: args.old_string,
        new: args.new_string,
      }), 'json')
      const command = `python3 -c '
import json, os, sys
m = json.load(open("/work/${meta}"))
os.unlink("/work/${meta}")
c = open(m["path"]).read()
if m["old"] not in c:
    print("old_string not found in file", file=sys.stderr); sys.exit(1)
open(m["path"],"w").write(c.replace(m["old"],m["new"],1))
print("ok")
'`
      try {
        const r = await run(command, 'patch')
        return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || r.stdout || 'patch failed' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── search ──

  search: tool({
    description: 'Search file contents using grep with regex support. Large results are written to a file; use the read tool to paginate.',
    inputSchema: validate.tool.search,
    outputSchema: boundedOutput,
    execute: async (args) => {
      const searchPath = args.path ? `/work/${args.path}` : '/work'
      const parts = ['grep', '-rn', '--color=never']
      if (!args.no_exclude) parts.push('--exclude-dir=.git', '--exclude-dir=node_modules', '--exclude-dir=__pycache__', '--exclude-dir=.venv', '--exclude-dir=.foundry')
      if (args.glob) parts.push('--include', esc(args.glob))
      parts.push('-e', esc(args.pattern), esc(searchPath))
      // || true so exit 1 (no matches) doesn't mark execution as failed
      const command = `${parts.join(' ')} | sed 's|/work/||g' || true`
      try {
        const r = await run(command, 'search')
        const output = r.stdout.trimEnd()
        if (!output) return { content: '' }
        return bounded(output)
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── find ──

  find: tool({
    description: 'List files matching a glob pattern in the workspace. Large results are written to a file; use the read tool to paginate.',
    inputSchema: validate.tool.find,
    outputSchema: boundedOutput,
    execute: async (args) => {
      const depth = args.max_depth ?? 3
      const searchPath = args.path ? `/work/${args.path}` : '/work'
      const parts = ['find', esc(searchPath), '-maxdepth', String(depth)]
      if (!args.no_exclude) parts.push('\\(', '-name', '.git', '-o', '-name', 'node_modules', '-o', '-name', '__pycache__', '-o', '-name', '.venv', '-o', '-name', '.foundry', '\\)', '-prune', '-o')
      parts.push('-type', 'f', '-name', esc(args.pattern), '-print')
      const command = `${parts.join(' ')} | sed 's|/work/||g'`
      try {
        const r = await run(command, 'find')
        const output = r.stdout.trim()
        if (!output) return { content: '' }
        return bounded(output)
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── fetch ──

  fetch: tool({
    description: 'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',
    inputSchema: validate.tool.fetch,
    outputSchema: boundedOutput.extend({ status: z.number() }),
    execute: async (args) => {
      const curlArgs = ['-s', '-w', '\\n%{http_code}', '-X', args.method ?? 'GET']
      if (args.headers) {
        for (const [k, val] of Object.entries(args.headers)) curlArgs.push('-H', `${k}: ${val}`)
      }
      if (args.body) curlArgs.push('-d', args.body)
      curlArgs.push(args.url)
      const command = `curl ${curlArgs.map(a => esc(a)).join(' ')}`
      try {
        const r = await run(command, 'fetch', true)
        const lines = r.stdout.trimEnd().split('\n')
        const statusCode = parseInt(lines.pop() ?? '0', 10)
        return { ...bounded(lines.join('\n')), status: statusCode }
      } catch (err) {
        return { content: '', status: 0, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── scrape ──

  scrape: tool({
    description: 'Extract clean readable text from a web page. Large output is written to a file; use the read tool to paginate.',
    inputSchema: validate.tool.scrape,
    outputSchema: boundedOutput,
    execute: async (args) => {
      const url = esc(args.url)
      const command = `lynx -dump -nolist -width=120 ${url} 2>/dev/null || curl -sL ${url} | sed 's/<[^>]*>//g' | sed '/^$/d' | head -500`
      try {
        const r = await run(command, 'scrape', true)
        return bounded(r.stdout.trim())
      } catch (err) {
        return { content: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  // ── think ──

  think: tool({
    description: 'Use this tool to reason, plan, or analyze before taking action. No side effects.',
    inputSchema: validate.tool.think,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  }),

  // ── agents ──

  agents: tool({
    description: 'List all agents in the current project. Useful for targeting sub-tickets at a specific agent.',
    inputSchema: z.object({}),
    outputSchema: boundedOutput,
    execute: async () => {
      const command = `curl -sf '${api}/agent?projectId=${projectId}'`
      return runApi(command, 'agents')
    },
  }),

  // ── ticket ──

  ticket: tool({
    description: 'Create, read, or list tickets in the current project. Use create to spawn sub-tasks, optionally assigning to an agent by ID. Use the agents tool first to discover agent IDs.',
    inputSchema: validate.tool.ticket,
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
        command = `curl -sf -X POST -H 'Content-Type: application/json' -d ${esc(payload)} '${api}/ticket'`
      } else {
        return { content: '', error: 'unknown action' }
      }
      return runApi(command, 'ticket')
    },
  }),
})}
