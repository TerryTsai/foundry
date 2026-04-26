// Helpers used by multiple MCP server modules. SDK-agnostic: pure
// TypeScript utilities, no tool wrapping. The buildSdk (Anthropic Agent
// SDK) and buildAi (Vercel ai SDK) adapters in each engine import from
// here.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ulid } from 'ulid'

import type { Connection } from '@foundry/db'
import type {
  DecryptSecret,
  RunCommandOptions, RunCommandCtx, BoundedOutput,
} from '../types.js'
import { BOUNDED_THRESHOLD } from '../types.js'

// Re-exports so existing per-integration tools.ts files (and external
// consumers via @foundry/mcp's index.ts) keep their import surface
// unchanged after the type-relocation sweep.
export type { ConnCtx, RunCommandOptions, RunCommandCtx } from '../types.js'
export { BOUNDED_THRESHOLD, boundedOutput } from '../types.js'

// ── parseConn ──
// Decode a Connection row into the (secrets, config) record pair every
// connection-backed handler needs. The decryptSecret callback is
// injected because mcp can't depend on @foundry/crud.
export function parseConn(
  conn: Connection, decryptSecret: DecryptSecret,
): { secrets: Record<string, string>; connConfig: Record<string, unknown> } {
  let secrets:    Record<string, string>  = {}
  let connConfig: Record<string, unknown> = {}
  try { secrets    = JSON.parse(decryptSecret(conn.secrets)) as Record<string, string>  } catch {}
  try { connConfig = JSON.parse(conn.config)  as Record<string, unknown> } catch {}
  return { secrets, connConfig }
}

// ── Output bounding ──
// Large tool stdout/stderr gets spilled to a file in the workspace so the
// agent can paginate it via the read tool. Keeps single tool calls small
// in the context window.

export function bounded(workspace: string, raw: string): BoundedOutput {
  const bytes = Buffer.byteLength(raw, 'utf-8')
  if (bytes <= BOUNDED_THRESHOLD) return { content: raw }
  const filename = spillToFile(workspace, raw)
  const lines = raw.split('\n')
  return {
    content:    lines.slice(0, 20).join('\n'),
    outputFile: `.foundry/output/${filename}`,
    totalLines: lines.length,
    totalBytes: bytes,
  }
}

function spillToFile(workspace: string, raw: string): string {
  const outputDir = join(workspace, '.foundry', 'output')
  mkdirSync(outputDir, { recursive: true })
  const filename = `${ulid()}.txt`
  writeFileSync(join(outputDir, filename), raw, 'utf-8')
  return filename
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
// printing the push URL on failure). Patterns are intentionally loose —
// false positives are fine, false negatives are not. Both replacements
// inlined per the repetition-over-abstraction principle.

export function scrubSecrets(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  return s
    .replace(/x-access-token:[^@\s'"]+@/g, 'x-access-token:[REDACTED]@')
    .replace(/Bearer\s+(ghs_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)/g, 'Bearer [REDACTED]')
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

// Extract the BetaMessage tool_use block id that caused this MCP tool
// call. The SDK stashes it under `_meta["claudecode/toolUseId"]`. Helper
// so every handler can pull it uniformly from the opaque `extra` arg.
export function toolUseId(extra: unknown): string | undefined {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta
  const id = meta?.['claudecode/toolUseId']
  return typeof id === 'string' ? id : undefined
}

// ── Sandbox exec wrapper ──
// runCommand execs a command into this session's persistent podman
// container. State — filesystem writes, background processes, chromium,
// dev servers, installed packages — persists across calls within a
// session. Used by every tool that touches the sandbox.
//
// The `executionCreate` callback (lifted into ctx by the engine layer)
// owns the actual sandbox lifecycle; this module is not allowed to
// import @foundry/sandbox directly.

export function runCommand(
  ctx: RunCommandCtx,
  command: string, toolName: string, toolInput: unknown, options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { emitter } = ctx.executionCreate({
    command, session_id: ctx.sessionId, tool_name: toolName, tool_input: toolInput,
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
