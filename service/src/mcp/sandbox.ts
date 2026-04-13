// Sandbox server: isolated Linux environment with a persistent per-session
// working directory. Every tool call spawns its own podman container with
// the session tmpdir bind-mounted at /work. State persists between calls
// because the tmpdir lives on the host; the container is ephemeral.
//
// Structure: handler functions are SDK-agnostic. buildSdk wraps them as
// Anthropic Claude Agent SDK tools (createSdkMcpServer). buildAi wraps
// them as Vercel ai SDK tools (tool(...)). Both runners consume the
// same handlers via their respective builder.
//
// Mutating tools (write, patch, remove) reject paths inside `.git/` and
// `.foundry/` — the former prevents the agent from corrupting the repo
// that the github server is operating against, the latter protects the
// framework's scratch directories. This is the RCA-001 #2 mitigation
// at the tool boundary.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { ulid } from 'ulid'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import * as validate from '../validate.js'
import { asText, bounded, boundedOutput, esc, runCommand, toolUseId } from './_shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'sandbox',
  name:        'Sandbox',
  description: 'Isolated Linux environment with a persistent session workspace: files, commands, search.',
  tools: [
    { name: 'run',    description: 'Run a single shell command in the sandbox.' },
    { name: 'exec',   description: 'Run an arbitrary shell command (admin escape hatch, not included by default).' },
    { name: 'read',   description: 'Read a file from the workspace, with optional offset/limit pagination.' },
    { name: 'write',  description: 'Create or overwrite a file in the workspace.' },
    { name: 'patch',  description: 'Apply a targeted string replacement to a file.' },
    { name: 'remove', description: 'Delete a file or directory from the workspace.' },
    { name: 'find',   description: 'Find files by glob pattern.' },
    { name: 'search', description: 'Regex-grep across files.' },
  ],
}

export interface SandboxCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
  /** Per-call: tool_use block id the handler is responding to. Set by
   *  the sdkTool wrapper from `extra._meta["claudecode/toolUseId"]`. */
  toolUseId?: string
}

// ── Local helpers ──

// Relative paths are rooted at /work (the workspace bind-mount) for
// ergonomics: most tool calls target the project source. Absolute paths
// pass through so the agent can reach /tmp, /proc, /etc. Empty/undefined
// defaults to /work.
function workPath(p?: string): string {
  if (!p) return '/work'
  if (p.startsWith('/')) return p
  return `/work/${p}`
}

// Scratch file written into the workspace so the container can read it
// via bind mount. Used by patch to smuggle multi-line JSON metadata
// without shell-quoting nightmares.
function writeTmp(workspace: string, content: string, ext = 'txt'): string {
  const relPath = `.foundry/.tmp/${ulid()}.${ext}`
  const absPath = join(workspace, relPath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, 'utf-8')
  return relPath
}

// Reject paths that would let the agent corrupt git state or the
// framework's own scratch directories. Only applied to mutating tools —
// read/exec/search/find can still look anywhere in /work.
function assertSafeWritePath(p: string): void {
  if (!p) throw new Error('path is required')
  const abs = workPath(p)
  const rel = abs.startsWith('/work/') ? abs.slice('/work/'.length) : abs
  const segments = rel.split('/')
  if (segments.includes('..'))    throw new Error(`path traversal rejected: ${p}`)
  if (segments[0] === '.git')     throw new Error(`.git/ paths are protected: ${p}`)
  if (segments[0] === '.foundry') throw new Error(`.foundry/ paths are protected: ${p}`)
}

// ── Handlers ──

// Core shell execution — used by both `run` (default) and `exec` (admin).
// Same sandbox, same container, same cgroup tracking. The difference is
// which agents see which tool name + how the description guides usage.
async function handleShell(ctx: SandboxCtx, toolName: string, args: z.infer<typeof validate.toolExec>) {
  const command = args.cwd ? `cd ${esc(args.cwd)} && ${args.command}` : args.command
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, toolName, args, { network: args.network ?? false, toolUseId: ctx.toolUseId })
    return { ...bounded(ctx.workspace, r.stdout), stderr: r.stderr, exitCode: r.exitCode }
  } catch (err) {
    return { content: '', stderr: '', exitCode: -1, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleRun(ctx: SandboxCtx, args: z.infer<typeof validate.toolExec>) {
  return handleShell(ctx, 'run', args)
}

async function handleExec(ctx: SandboxCtx, args: z.infer<typeof validate.toolExec>) {
  return handleShell(ctx, 'exec', args)
}

async function handleRead(ctx: SandboxCtx, args: z.infer<typeof validate.toolRead>) {
  const path = esc(workPath(args.path))
  const command = (args.offset !== undefined || args.limit !== undefined)
    ? `sed -n '${(args.offset ?? 0) + 1},${(args.offset ?? 0) + (args.limit ?? 1_000_000)}p' ${path}`
    : `cat ${path}`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'read', args, { toolUseId: ctx.toolUseId })
    if (r.exitCode !== 0) return { content: '', error: r.stderr || 'file not found or unreadable' }
    return bounded(ctx.workspace, r.stdout)
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleWrite(ctx: SandboxCtx, args: z.infer<typeof validate.toolWrite>) {
  try { assertSafeWritePath(args.path) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const tmpRel = writeTmp(ctx.workspace, args.content)
  const dest = esc(workPath(args.path))
  const command = `mkdir -p "$(dirname ${dest})" && mv /work/${esc(tmpRel)} ${dest}`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'write', { path: args.path }, { toolUseId: ctx.toolUseId })
    return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || 'write failed' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handlePatch(ctx: SandboxCtx, args: z.infer<typeof validate.toolPatch>) {
  try { assertSafeWritePath(args.path) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const meta = writeTmp(ctx.workspace, JSON.stringify({
    path: workPath(args.path),
    old:  args.old_string,
    new:  args.new_string,
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
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'patch', { path: args.path }, { toolUseId: ctx.toolUseId })
    return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || r.stdout || 'patch failed' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const removeSchema = z.object({
  path: z.string().describe('Path to delete, relative to workspace root.'),
})

async function handleRemove(ctx: SandboxCtx, args: z.infer<typeof removeSchema>) {
  try { assertSafeWritePath(args.path) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const target = esc(workPath(args.path))
  const command = `rm -rf ${target}`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'remove', { path: args.path }, { toolUseId: ctx.toolUseId })
    return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || 'remove failed' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleSearch(ctx: SandboxCtx, args: z.infer<typeof validate.toolSearch>) {
  const searchPath = workPath(args.path)
  const parts = ['grep', '-rn', '--color=never']
  if (args.glob) parts.push('--include', esc(args.glob))
  parts.push('-e', esc(args.pattern), esc(searchPath))
  const command = `${parts.join(' ')} | sed 's|/work/||g' || true`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'search', args, { toolUseId: ctx.toolUseId })
    const output = r.stdout.trimEnd()
    if (!output) return { content: '' }
    return bounded(ctx.workspace, output)
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleFind(ctx: SandboxCtx, args: z.infer<typeof validate.toolFind>) {
  const depth = args.max_depth ?? 3
  const searchPath = workPath(args.path)
  const parts = ['find', esc(searchPath), '-maxdepth', String(depth), '-type', 'f', '-name', esc(args.pattern), '-print']
  const command = `${parts.join(' ')} | sed 's|/work/||g'`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'find', args, { toolUseId: ctx.toolUseId })
    const output = r.stdout.trim()
    if (!output) return { content: '' }
    return bounded(ctx.workspace, output)
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

// Tool descriptions carry the environmental contract — what state the tool
// expects and what it leaves behind. The agent needs no separate preamble.
const DESC = {
  run:
    'Run a single shell command in the session sandbox. The workspace is bind-mounted at /work and persists across calls within this session. ' +
    'The sandbox starts with an EMPTY /work — populate it yourself (e.g. via gitClone). ' +
    'Pre-installed: git, node/npm/npx, tsc, prettier, eslint, tsx, python3, curl, wget, jq, lynx, make, gcc, and standard unix tools. ' +
    '$HOME is /tmp so package managers work without flags. ' +
    'Network is disabled by default; pass network:true for outbound access. ' +
    'Prefer one command per call for clean audit trails — avoid chaining with && or ;. ' +
    'Large stdout is written to a file; use the read tool to paginate.',
  exec:
    'Run an arbitrary shell command in the session sandbox (admin escape hatch). Same environment as `run` but intended for complex multi-command pipelines, shell scripting, and administrative tasks. ' +
    'Not included by default — enable per-agent for roles that need unstructured shell access.',
  read:   'Read the contents of a file from the workspace. Use offset and limit to paginate. Large output is written to a file you can read with offset/limit. Reads against an empty workspace return "not found" — populate /work first.',
  write:  'Create or overwrite a file in the workspace. Parent directories are created as needed. .git/ and .foundry/ paths are protected.',
  patch:  'Apply a targeted edit to a file by replacing an exact string match. Fails if the old_string is not found or appears more than once. .git/ and .foundry/ paths are protected.',
  remove: 'Delete a file or directory from the workspace (recursive). .git/ and .foundry/ paths are protected.',
  search: 'Search file contents using grep with regex support across the workspace. Large output is written to a file you can read with offset/limit. Returns empty for an empty workspace.',
  find:   'List files matching a glob pattern in the workspace. Defaults to max_depth 3 for performance — increase or omit to scan deeper. If a deep scan times out, narrow the path or pattern. Large output is written to a file you can read with offset/limit.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: SandboxCtx, allowed?: string[] | '*' | null) {
  const tu = (x: unknown): SandboxCtx => ({ ...ctx, toolUseId: toolUseId(x) })
  const all = [
    sdkTool('run',    DESC.run,    validate.toolExec.shape,   async (a, x) => asText(await handleRun(tu(x), a))),
    sdkTool('exec',   DESC.exec,   validate.toolExec.shape,   async (a, x) => asText(await handleExec(tu(x), a))),
    sdkTool('read',   DESC.read,   validate.toolRead.shape,   async (a, x) => asText(await handleRead(tu(x), a))),
    sdkTool('write',  DESC.write,  validate.toolWrite.shape,  async (a, x) => asText(await handleWrite(tu(x), a))),
    sdkTool('patch',  DESC.patch,  validate.toolPatch.shape,  async (a, x) => asText(await handlePatch(tu(x), a))),
    sdkTool('remove', DESC.remove, removeSchema.shape,        async (a, x) => asText(await handleRemove(tu(x), a))),
    sdkTool('search', DESC.search, validate.toolSearch.shape, async (a, x) => asText(await handleSearch(tu(x), a))),
    sdkTool('find',   DESC.find,   validate.toolFind.shape,   async (a, x) => asText(await handleFind(tu(x), a))),
  ]
  return createSdkMcpServer({ name: 'sandbox', tools: filterTools(all, allowed) })
}

// ── Vercel ai SDK adapter ──

export function buildAi(ctx: SandboxCtx) {
  return {
    run: tool({
      description:  DESC.run,
      inputSchema:  validate.toolExec,
      outputSchema: boundedOutput.extend({ stderr: z.string(), exitCode: z.number() }),
      execute:      (args: z.infer<typeof validate.toolExec>) => handleRun(ctx, args),
    }),
    exec: tool({
      description:  DESC.exec,
      inputSchema:  validate.toolExec,
      outputSchema: boundedOutput.extend({ stderr: z.string(), exitCode: z.number() }),
      execute:      (args: z.infer<typeof validate.toolExec>) => handleExec(ctx, args),
    }),
    read: tool({
      description:  DESC.read,
      inputSchema:  validate.toolRead,
      outputSchema: boundedOutput,
      execute:      (args: z.infer<typeof validate.toolRead>) => handleRead(ctx, args),
    }),
    write: tool({
      description:  DESC.write,
      inputSchema:  validate.toolWrite,
      outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
      execute:      (args: z.infer<typeof validate.toolWrite>) => handleWrite(ctx, args),
    }),
    patch: tool({
      description:  DESC.patch,
      inputSchema:  validate.toolPatch,
      outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
      execute:      (args: z.infer<typeof validate.toolPatch>) => handlePatch(ctx, args),
    }),
    remove: tool({
      description:  DESC.remove,
      inputSchema:  removeSchema,
      outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
      execute:      (args: z.infer<typeof removeSchema>) => handleRemove(ctx, args),
    }),
    search: tool({
      description:  DESC.search,
      inputSchema:  validate.toolSearch,
      outputSchema: boundedOutput,
      execute:      (args: z.infer<typeof validate.toolSearch>) => handleSearch(ctx, args),
    }),
    find: tool({
      description:  DESC.find,
      inputSchema:  validate.toolFind,
      outputSchema: boundedOutput,
      execute:      (args: z.infer<typeof validate.toolFind>) => handleFind(ctx, args),
    }),
  }
}
