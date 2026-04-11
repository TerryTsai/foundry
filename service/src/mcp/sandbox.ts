// Sandbox server: isolated Linux environment with a persistent per-session
// working directory. Every tool call spawns its own podman container with
// the session tmpdir bind-mounted at /work. State persists between calls
// because the tmpdir lives on the host; the container is ephemeral.
//
// Mutating tools (write, patch, remove) reject paths inside `.git/` and
// `.foundry/` — the former prevents the agent from corrupting the repo
// that the github server is operating against, the latter protects the
// framework's scratch directories (`.foundry/.tmp/`, `.foundry/output/`).
// This is the RCA-001 #2 mitigation at the tool boundary.
//
// Helpers are imported from runtime/tool.js during migration; they'll
// move to mcp/_shared.ts once the other servers land.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import * as validate from '../validate.js'
import {
  asText, bounded, esc, runCommand, workPath, writeTmp,
} from '../runtime/tool.js'

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'sandbox',
  name:        'Sandbox',
  description: 'Isolated Linux environment with a persistent session workspace: files, commands, search.',
  tools: [
    { name: 'exec',   description: 'Run a shell command in a sandboxed container. Workspace at /work.' },
    { name: 'read',   description: 'Read a file from the workspace, with optional offset/limit pagination.' },
    { name: 'write',  description: 'Create or overwrite a file in the workspace.' },
    { name: 'patch',  description: 'Apply a targeted string replacement to a file.' },
    { name: 'remove', description: 'Delete a file or directory from the workspace.' },
    { name: 'find',   description: 'Find files by glob pattern.' },
    { name: 'search', description: 'Regex-grep across files.' },
  ],
}

// Reject paths that would let the agent corrupt git state or the
// framework's own scratch directories. Only applied to mutating tools —
// read/exec/search/find can still look anywhere in /work.
function assertSafeWritePath(p: string): void {
  if (!p) throw new Error('path is required')
  const abs = workPath(p)
  const rel = abs.startsWith('/work/') ? abs.slice('/work/'.length) : abs
  const first = rel.split('/')[0]
  if (rel.split('/').includes('..')) throw new Error(`path traversal rejected: ${p}`)
  if (first === '.git')     throw new Error(`.git/ paths are protected: ${p}`)
  if (first === '.foundry') throw new Error(`.foundry/ paths are protected: ${p}`)
}

export function build(db: Db, config: Config, sessionId: string, workspace: string) {
  return createSdkMcpServer({
    name: 'sandbox',
    tools: [

      sdkTool(
        'exec',
        'Run a shell command in a sandboxed container with the workspace at /work. Large stdout is written to a file; use the read tool to paginate.',
        validate.toolExec.shape,
        async (args) => {
          const command = args.cwd ? `cd ${esc(args.cwd)} && ${args.command}` : args.command
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'exec', args, args.network ?? false)
            return asText({ ...bounded(workspace, r.stdout), stderr: r.stderr, exitCode: r.exitCode })
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'read',
        'Read the contents of a file from the workspace. Use offset and limit to paginate. Large output is written to a file you can read with offset/limit.',
        validate.toolRead.shape,
        async (args) => {
          const path = esc(workPath(args.path))
          const command = (args.offset !== undefined || args.limit !== undefined)
            ? `sed -n '${(args.offset ?? 0) + 1},${(args.offset ?? 0) + (args.limit ?? 1_000_000)}p' ${path}`
            : `cat ${path}`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'read', args)
            if (r.exitCode !== 0) return asText({ error: r.stderr || 'file not found or unreadable' })
            return asText(bounded(workspace, r.stdout))
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'write',
        'Create or overwrite a file in the workspace. .git/ and .foundry/ paths are protected.',
        validate.toolWrite.shape,
        async (args) => {
          try { assertSafeWritePath(args.path) } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const tmpRel = writeTmp(workspace, args.content)
          const dest = esc(workPath(args.path))
          const command = `mkdir -p "$(dirname ${dest})" && mv /work/${esc(tmpRel)} ${dest}`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'write', { path: args.path })
            return asText(r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || 'write failed' })
          } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'patch',
        'Apply a targeted edit to a file by replacing an exact string match. .git/ and .foundry/ paths are protected.',
        validate.toolPatch.shape,
        async (args) => {
          try { assertSafeWritePath(args.path) } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const meta = writeTmp(workspace, JSON.stringify({
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
            const r = await runCommand(db, config, sessionId, workspace, command, 'patch', { path: args.path })
            return asText(r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || r.stdout || 'patch failed' })
          } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'remove',
        'Delete a file or directory from the workspace (recursive). .git/ and .foundry/ paths are protected.',
        { path: z.string().describe('Path to delete, relative to workspace root.') },
        async (args) => {
          try { assertSafeWritePath(args.path) } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const target = esc(workPath(args.path))
          const command = `rm -rf ${target}`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'remove', { path: args.path })
            return asText(r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr || 'remove failed' })
          } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'search',
        'Search file contents using grep with regex support. Large output is written to a file you can read with offset/limit.',
        validate.toolSearch.shape,
        async (args) => {
          const searchPath = workPath(args.path)
          const parts = ['grep', '-rn', '--color=never']
          if (args.glob) parts.push('--include', esc(args.glob))
          parts.push('-e', esc(args.pattern), esc(searchPath))
          const command = `${parts.join(' ')} | sed 's|/work/||g' || true`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'search', args)
            const output = r.stdout.trimEnd()
            if (!output) return asText({ content: '' })
            return asText(bounded(workspace, output))
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

      sdkTool(
        'find',
        'List files matching a glob pattern in the workspace. Defaults to max_depth 3 for performance — increase or omit to scan deeper. If a deep scan times out, narrow the path or pattern. Large output is written to a file you can read with offset/limit.',
        validate.toolFind.shape,
        async (args) => {
          const depth = args.max_depth ?? 3
          const searchPath = workPath(args.path)
          const parts = ['find', esc(searchPath), '-maxdepth', String(depth), '-type', 'f', '-name', esc(args.pattern), '-print']
          const command = `${parts.join(' ')} | sed 's|/work/||g'`
          try {
            const r = await runCommand(db, config, sessionId, workspace, command, 'find', args)
            const output = r.stdout.trim()
            if (!output) return asText({ content: '' })
            return asText(bounded(workspace, output))
          } catch (err) {
            return asText({ error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

    ],
  })
}
