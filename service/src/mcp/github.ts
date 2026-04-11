// GitHub development-flow server. Tools operate against the session's
// shared working directory (the same tmpdir the sandbox server's execs
// bind-mount at /work). At session start the runner calls workspaceClone()
// to populate it and creates a per-session branch; the agent edits files
// via sandbox tools, stages them via gitAdd, and publishes via the
// pullRequestCreate tool when ready.
//
// All git operations run host-side via execFile — the sandbox image does
// not include a git binary, so the only way git state changes is through
// the tools on this server (RCA-001 mitigation).
//
// Scope is deliberately narrow for v1: inspect, stage, commit, open PR.
// API operations (issue search, PR review, code search) belong in the
// community GitHub MCP server if we want them later.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Ticket } from '../schema.js'
import * as domain from '../domain.js'
import { require, succeeds, toInt } from '../functional.js'
import { repoCloneUrl, pullRequestCreate as githubPullRequestCreate } from '../github.js'
import { asText } from '../runtime/tool.js'

import type { McpServerInfo } from './registry.js'

const execFileAsync = promisify(execFile)

export const info: McpServerInfo = {
  id:          'github',
  name:        'GitHub',
  description: 'Development flow against a configured GitHub repo: inspect, stage, commit, open draft PRs.',
  tools: [
    { name: 'gitStatus',         description: 'Show the working tree status (porcelain format).' },
    { name: 'gitDiff',           description: 'Show the working-tree or staged diff, optionally scoped to paths.' },
    { name: 'gitAdd',            description: 'Stage specific paths for commit. Literal paths only — no -A, no wildcards.' },
    { name: 'gitRemove',         description: 'Remove paths from the working tree and index (git rm).' },
    { name: 'gitCommit',         description: 'Commit the staged index with a message.' },
    { name: 'pullRequestCreate', description: 'Push the session branch and open a draft pull request.' },
  ],
}

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE LIFECYCLE (relocated from service/src/runtime/workspace.ts)
// ════════════════════════════════════════════════════════════════════════════

export interface PublishResult {
  branch: string
  prUrl:  string
}

function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo.trim())
  if (!m) throw new Error(`invalid repo "${repo}" — expected "owner/name"`)
  return { owner: m[1], name: m[2] }
}

export async function workspaceEmpty(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundry-session-'))
}

// Clone the project's GitHub repo into a fresh tmpdir, strip the
// installation token from .git/config, create the per-session branch, and
// return the working directory. Called host-side by the runner at session
// start — never runs inside a sandbox container.
export async function workspaceClone(db: Db, config: Config, projectId: string, sessionId: string): Promise<string> {
  const proj = require(database.projectGet(db, projectId), `project ${projectId} not found`)
  if (!proj.repo) throw new Error(`project ${proj.name} has no repo configured`)
  const { owner, name } = parseRepo(proj.repo)

  const cloneUrl = await repoCloneUrl(config, owner, name)
  const workDir  = await workspaceEmpty()
  await execFileAsync('git', ['clone', cloneUrl, workDir])

  // Strip the token out of .git/config; we'll mint a fresh one at push time.
  await execFileAsync('git', ['-C', workDir, 'remote', 'set-url', 'origin', `https://github.com/${owner}/${name}.git`])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name',  'Foundry'])

  // Create and switch to the per-session branch. The agent commits land here,
  // pullRequestCreate pushes it, draft PR opens against the base branch.
  await execFileAsync('git', ['-C', workDir, 'checkout', '-b', `foundry/${sessionId}`])

  return workDir
}

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLS
// ════════════════════════════════════════════════════════════════════════════

// Paths the agent may never stage — known garbage directories that have
// caused incidents (RCA-001) or that are structurally host-only. First
// segment of the path is checked against this list.
const DENIED_PATH_PREFIXES = new Set([
  '.git', '.foundry', 'node_modules', '.npm-cache',
  'dist', 'build', 'coverage', 'target', 'vendor',
  '.cache', '.next', '.nuxt',
])

function assertSafeAddPath(p: string): void {
  if (!p || p.trim() === '')       throw new Error('path is required')
  if (p === '.' || p === '-A' || p === '--all') throw new Error(`invalid path: ${p}`)
  if (p.startsWith('/'))            throw new Error(`absolute paths not allowed: ${p}`)
  if (p.split('/').includes('..'))  throw new Error(`path traversal not allowed: ${p}`)
  if (/[*?[\]{}]/.test(p))          throw new Error(`wildcards not allowed (pass literal paths): ${p}`)
  const first = p.split('/')[0]
  if (DENIED_PATH_PREFIXES.has(first)) {
    throw new Error(`${first}/ paths are protected: ${p}`)
  }
}

// Thin wrapper over `git -C <workDir> <args>`. Never throws on non-zero exit;
// the tool layer decides whether that's an error or expected (git diff --cached
// --quiet is the canonical "nothing staged" signal, for example).
async function gitExec(workDir: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', workDir, ...args])
    return { stdout, stderr, exitCode: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? (err instanceof Error ? err.message : String(err)), exitCode: e.code ?? 1 }
  }
}

export interface GithubCtx {
  db:         Db
  config:     Config
  sessionId:  string
  workDir:    string
  ticket:     Ticket
  agentName:  string
}

export function build(ctx: GithubCtx) {
  const { db, config, sessionId, workDir, ticket, agentName } = ctx
  const branch = `foundry/${sessionId}`

  return createSdkMcpServer({
    name: 'github',
    tools: [

      sdkTool(
        'gitStatus',
        'Show the working tree status in porcelain format.',
        {},
        async () => {
          const r = await gitExec(workDir, ['status', '--porcelain=v1'])
          if (r.exitCode !== 0) return asText({ error: r.stderr })
          return asText({ status: r.stdout })
        },
      ),

      sdkTool(
        'gitDiff',
        'Show the diff. By default shows unstaged changes; set staged=true to see the staged diff. Optionally scope to specific paths.',
        {
          staged: z.boolean().optional().describe('Show the staged (index) diff instead of the working-tree diff.'),
          paths:  z.array(z.string()).optional().describe('Optional: restrict diff to these paths.'),
        },
        async (args) => {
          const diffArgs = ['diff']
          if (args.staged) diffArgs.push('--cached')
          if (args.paths && args.paths.length > 0) diffArgs.push('--', ...args.paths)
          const r = await gitExec(workDir, diffArgs)
          if (r.exitCode !== 0) return asText({ error: r.stderr })
          return asText({ diff: r.stdout })
        },
      ),

      sdkTool(
        'gitAdd',
        'Stage specific paths for commit. Only literal repo-relative paths are accepted — no -A, no wildcards, no glob expansion. Paths inside .git/, .foundry/, node_modules/, build outputs, and caches are rejected.',
        {
          paths: z.array(z.string()).min(1).describe('Literal repo-relative paths to stage.'),
        },
        async (args) => {
          try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const r = await gitExec(workDir, ['add', '--', ...args.paths])
          if (r.exitCode !== 0) return asText({ ok: false, error: r.stderr || r.stdout })
          return asText({ ok: true, staged: args.paths })
        },
      ),

      sdkTool(
        'gitRemove',
        'Remove paths from the working tree and index (git rm). Same validation as gitAdd — literal paths only, protected directories rejected.',
        {
          paths: z.array(z.string()).min(1).describe('Literal repo-relative paths to remove.'),
        },
        async (args) => {
          try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const r = await gitExec(workDir, ['rm', '-r', '--', ...args.paths])
          if (r.exitCode !== 0) return asText({ ok: false, error: r.stderr || r.stdout })
          return asText({ ok: true, removed: args.paths })
        },
      ),

      sdkTool(
        'gitCommit',
        'Commit the staged index with a message. Fails if nothing is staged.',
        {
          message: z.string().min(1).describe('Commit message (first line is the subject).'),
        },
        async (args) => {
          // Refuse empty commits — "nothing to commit" should surface as a
          // clear error, not a silent no-op.
          const clean = await succeeds(() => execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet']))
          if (clean) return asText({ ok: false, error: 'nothing staged — call gitAdd first' })

          const fullMessage = `${args.message}\n\nSession: ${sessionId}\nTicket:  ${ticket.id}\n`
          const r = await gitExec(workDir, ['commit', '-m', fullMessage])
          if (r.exitCode !== 0) return asText({ ok: false, error: r.stderr || r.stdout })

          const head = await gitExec(workDir, ['rev-parse', 'HEAD'])
          return asText({ ok: true, commit: head.stdout.trim() })
        },
      ),

      sdkTool(
        'pullRequestCreate',
        'Push the session branch and open a draft pull request against the clone\'s default branch. Call after gitCommit. Posts a comment on the current ticket with the PR URL.',
        {
          title: z.string().optional().describe('Optional PR title. Defaults to "[<ticket-id>] <ticket title>".'),
          body:  z.string().optional().describe('Optional PR body. Defaults to a summary pointing at the ticket.'),
        },
        async (args) => {
          // The PR is opened against whatever branch the clone landed on
          // (typically main). We determine this by reading origin/HEAD.
          const baseRef = await gitExec(workDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
          const baseBranch = baseRef.exitCode === 0
            ? baseRef.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
            : 'main'

          // Verify the session branch has commits beyond the base.
          const ahead = await gitExec(workDir, ['rev-list', '--count', `${baseBranch}..HEAD`])
          if (ahead.exitCode !== 0 || toInt(ahead.stdout) === 0) {
            return asText({ ok: false, error: 'no commits to publish — call gitCommit first' })
          }

          try {
            const proj = require(database.projectGet(db, ticket.project_id), `project ${ticket.project_id} not found`)
            if (!proj.repo) return asText({ ok: false, error: 'project has no repo configured' })
            const { owner, name } = parseRepo(proj.repo)

            // Fresh install token for the push; the clone-time token was
            // stripped and is likely near expiry.
            const pushUrl = await repoCloneUrl(config, owner, name)
            const push = await gitExec(workDir, ['push', pushUrl, `HEAD:refs/heads/${branch}`])
            if (push.exitCode !== 0) return asText({ ok: false, error: push.stderr || push.stdout })

            const title = (args.title ?? `[${ticket.id}] ${ticket.title.trim() || '(no title)'}`).slice(0, 200)
            const body  = args.body ?? defaultPrBody(sessionId, ticket)

            const prUrl = await githubPullRequestCreate(config, owner, name, {
              title, head: branch, base: baseBranch, body, draft: true,
            })

            domain.commentCreate(db, ticket.id, {
              author:     agentName,
              body:       `Draft PR opened: ${prUrl}`,
              session_id: sessionId,
            })

            const result: PublishResult = { branch, prUrl }
            return asText({ ok: true, ...result })
          } catch (err) {
            return asText({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        },
      ),

    ],
  })
}

function defaultPrBody(sessionId: string, ticket: Ticket): string {
  const body = ticket.body.trim()
  const excerpt = body.length > 800 ? `${body.slice(0, 800)}…` : body
  return `Opened automatically by Foundry session \`${sessionId}\` for ticket \`${ticket.id}\`.

**Ticket:** ${ticket.title.trim() || '(no title)'}

> ${excerpt.replace(/\n/g, '\n> ')}

This PR is a draft. Review the diff and mark it Ready when you're satisfied.`
}
