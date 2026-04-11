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
import * as domain from '../domain.js'

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
// (exec, read, write, patch, remove, search, find, fetch, scrape).

export function runCommand(
  db: Db, config: Config, sessionId: string, workspace: string,
  command: string, toolName: string, toolInput: unknown, network = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { emitter } = domain.executionCreate(db, config, {
    command, session_id: sessionId, tool_name: toolName, tool_input: toolInput, network, workspace,
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
