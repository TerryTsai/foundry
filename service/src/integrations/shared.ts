// Helpers used by multiple MCP server modules. Everything here is
// SDK-agnostic: pure TypeScript utilities, no tool wrapping. The buildSdk
// (Anthropic Agent SDK) and buildAi (Vercel ai SDK) adapters in each
// server module import from here, so handler logic stays in one copy.

import type { Db as _Db } from '../core/db.js'
import type { Config as _Config } from '../core/config.js'

// Context passed into every connection-backed MCP server (cloudflare,
// resend, aws, …). Built-in servers (foundry/github/sandbox/browser)
// use their own richer ctx types.
export interface ConnCtx {
  db:             _Db
  config:         _Config
  sessionId:      string
  workspace:      string
  secrets:        Record<string, string>
  connConfig:     Record<string, unknown>
  connectionName: string
  toolUseId?:     string
}

import type { Connection } from '../core/schema.js'
import { decryptSecret } from '@foundry/crud'

export function parseConn(conn: Connection): { secrets: Record<string, string>; connConfig: Record<string, unknown> } {
  let secrets:    Record<string, string>  = {}
  let connConfig: Record<string, unknown> = {}
  try { secrets    = JSON.parse(decryptSecret(conn.secrets)) as Record<string, string>  } catch {}
  try { connConfig = JSON.parse(conn.config)  as Record<string, unknown> } catch {}
  return { secrets, connConfig }
}

import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ulid } from 'ulid'

import type { Db } from '../core/db.js'
import type { Config } from '../core/config.js'
import { executionCreate } from '@foundry/sandbox'

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

// Handlers that want to return non-text content (image, document) return
// a pre-formed MCP envelope. The sdkTool adapter below recognizes the
// shape and passes it through without re-wrapping.
export function isMcpEnvelope(v: unknown): v is { content: Array<Record<string, unknown>> } {
  return !!v && typeof v === 'object' && Array.isArray((v as { content?: unknown }).content)
}

export function asImage(bytes: Buffer, mime: string): { content: [{ type: 'image'; data: string; mimeType: string }] } {
  return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: mime }] }
}

// ── Sandbox exec wrapper ──
// runCommand execs a command into this session's persistent podman
// container (lazily started by ensureSessionContainer on first use).
// State — filesystem writes, background processes, chromium, dev
// servers, installed packages — persists across calls within a
// session. Used by every tool that touches the sandbox.
//
// Secrets travel via `env` only. Values are kept out of podman argv by
// podman exec's -e `KEY=value` pairs, and the scrubSecrets pass catches
// accidental echoes in stdout/stderr before the execution row is saved.

export interface RunCommandOptions {
  env?:       Record<string, string>  // extra env vars for the exec; NOT logged to DB
  timeoutMs?: number                   // override config.sandboxTimeout
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
  db: Db, config: Config, sessionId: string, _workspace: string,
  command: string, toolName: string, toolInput: unknown, options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { emitter } = executionCreate(db, config, {
    command, session_id: sessionId, tool_name: toolName, tool_input: toolInput,
    tool_use_id: options.toolUseId,
    timeout_ms:  options.timeoutMs,
    env:         options.env,
  })
  const stdout: string[] = []
  const stderr: string[] = []
  return new Promise(resolve => {
    emitter.on('stdout', (line: string) => stdout.push(line))
    emitter.on('stderr', (line: string) => stderr.push(line))
    emitter.once('exit', (code: number) => {
      resolve({ stdout: stdout.join(''), stderr: stderr.join(''), exitCode: code })
    })
  })
}
