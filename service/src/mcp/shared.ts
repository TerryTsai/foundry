// Helpers used by multiple MCP server modules. Everything here is
// SDK-agnostic: pure TypeScript utilities, no tool wrapping. The buildSdk
// (Anthropic Agent SDK) and buildAi (Vercel ai SDK) adapters in each
// server module import from here, so handler logic stays in one copy.

import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ulid } from 'ulid'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import { executionCreate } from '../domain/executions.js'

// ── Output bounding ──
// Large tool stdout/stderr gets spilled to a file in the workspace so the
// agent can paginate it via the read tool. Keeps single tool calls small
// in the context window.

export const BOUNDED_THRESHOLD = 10_240 // 10 KB

export const boundedOutput = z.object({
  content:    z.string(),
  outputFile: z.string().optional(),
  totalLines: z.number().optional(),
  totalBytes: z.number().optional(),
  error:      z.string().optional(),
})

export function bounded(
  workspace: string, raw: string,
): { content: string; outputFile?: string; totalLines?: number; totalBytes?: number } {
  const bytes = Buffer.byteLength(raw, 'utf-8')
  if (bytes <= BOUNDED_THRESHOLD) return { content: raw }

  const outputDir = join(workspace, '.foundry', 'output')
  mkdirSync(outputDir, { recursive: true })
  const filename = `${ulid()}.txt`
  writeFileSync(join(outputDir, filename), raw, 'utf-8')

  const lines = raw.split('\n')
  return {
    content:    lines.slice(0, 20).join('\n'),
    outputFile: `.foundry/output/${filename}`,
    totalLines: lines.length,
    totalBytes: bytes,
  }
}

// ── Shell quoting ──
// POSIX-safe single-quote escape. Wraps a literal in single quotes and
// escapes embedded single quotes as '\''. Used by every tool that builds
// shell commands via string concatenation.

export function esc(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

// ── Secret scrubbing ──
// Belt-and-suspenders regex pass over anything about to be persisted to
// an execution row. Primary defense is "secrets never enter the sandbox"
// via tier-2 isolation; this catches the narrow failure modes where git
// or another tool might echo a token it received in its env (e.g. git
// printing the push URL on failure). The patterns are intentionally
// loose — false positives are fine, false negatives are not.

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Basic-auth tokens embedded in URLs (github install tokens, anything else)
  [/x-access-token:[^@\s'"]+@/g, 'x-access-token:[REDACTED]@'],
  // Bearer tokens for common providers
  [/Bearer\s+(ghs_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)/g, 'Bearer [REDACTED]'],
]

export function scrubSecrets(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  let out = s
  for (const [pat, rep] of SECRET_PATTERNS) out = out.replace(pat, rep)
  return out
}

// ── MCP content envelope ──
// Anthropic's sdkTool handlers must return { content: [{ type, text }] }.
// This wrapper lets core handlers return plain objects; the buildSdk
// adapter calls asText() to wrap. The buildAi adapter returns plain
// objects directly.

export function asText(value: unknown): { content: [{ type: 'text'; text: string }] } {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { content: [{ type: 'text', text }] }
}

// ── Sandbox exec wrapper ──
// runCommand spawns a podman container with the workspace bind-mounted,
// runs the command, captures stdout/stderr, and creates an execution row
// in the DB for audit. Used by every tool that runs inside the sandbox
// (exec, read, write, patch, remove, search, find, fetch, scrape, and
// the git tools in mcp/github.ts).
//
// The options object supports the tier-2 model: secret-using tools pass
// env vars (never serialized to the execution row) and can downgrade the
// workspace mount to 'ro' or remove it entirely.

export interface RunCommandOptions {
  network?: boolean
  env?:     Record<string, string>   // passed to podman; NOT logged to DB
  mount?:   'rw' | 'ro' | 'none'     // workspace bind mode, default 'rw'; ignored when artifacts are set
  /** Isolated workspace model. When either is set, /work is not mounted;
   *  /input (ro) holds the copied-in artifact allowlist, /output (rw)
   *  is a scratch that gets copied back to /work on success. */
  artifactsIn?:  { src: string; dest: string }[]
  artifactsOut?: { src: string; dest: string }[]
  /** tool_use block id from the SDK handler's `extra._meta`. Persisted
   *  on the execution row so the UI can correlate the sandbox-domain
   *  execution back to the agent-domain tool_use block that caused it. */
  toolUseId?: string
}

// Extract the BetaMessage tool_use block id that caused this MCP tool
// call. The SDK stashes it under `_meta["claudecode/toolUseId"]`. Helper
// so every handler can pull it uniformly from the opaque `extra` arg.
export function toolUseId(extra: unknown): string | undefined {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta
  const id = meta?.['claudecode/toolUseId']
  return typeof id === 'string' ? id : undefined
}

export function runCommand(
  db: Db, config: Config, sessionId: string, workspace: string,
  command: string, toolName: string, toolInput: unknown, options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { emitter } = executionCreate(db, config, {
    command, session_id: sessionId, tool_name: toolName, tool_input: toolInput,
    tool_use_id: options.toolUseId,
    network: options.network ?? false,
    env:     options.env ?? {},
    mount:   options.mount ?? 'rw',
    artifactsIn:  options.artifactsIn,
    artifactsOut: options.artifactsOut,
    workspace,
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
