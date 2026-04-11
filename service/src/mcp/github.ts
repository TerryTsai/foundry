// GitHub development-flow server. Tools operate against the session's
// shared working directory (the same tmpdir the sandbox server's execs
// bind-mount at /work). At session start the runner calls workspaceClone()
// to populate it and create a per-session branch; the agent edits files
// via sandbox tools, stages them via gitAdd, commits via gitCommit, and
// publishes via pullRequestCreate when ready.
//
// All git operations run host-side via execFile — the sandbox image does
// not include a git binary, so the only way git state changes is through
// the tools on this server.
//
// Structure: handler functions are SDK-agnostic. buildSdk wraps them as
// Anthropic Claude Agent SDK tools. buildAi wraps them as Vercel ai SDK
// tools. Both runners consume the same handlers. Workspace lifecycle
// (workspaceClone/Destroy/Empty) are plain exported functions — the
// runners call them directly, no SDK involvement.
//
// Scope is deliberately narrow: inspect, stage, commit, open PR. API
// operations (issue search, PR review) belong in a community GitHub MCP
// server if we want them later.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import type { Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Ticket } from '../schema.js'
import * as domain from '../domain.js'
import { require, succeeds, toInt } from '../functional.js'
import { repoCloneUrl, pullRequestCreate as githubPullRequestCreate } from '../github.js'
import { asText } from './_shared.js'

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
// WORKSPACE LIFECYCLE
// ════════════════════════════════════════════════════════════════════════════
// Plain functions called by runner.ts and sdk-runner.ts at session start /
// end. Not part of any MCP server — these are framework operations, not
// agent-callable tools.

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
// return the working directory. Called host-side by the runners at session
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

  // Create and switch to the per-session branch. The agent commits land
  // here, pullRequestCreate pushes it, draft PR opens against the base.
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
// the handler decides whether that's an error or expected (git diff --cached
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

// ── Schemas ──

const gitStatusArgs = z.object({})

const gitDiffArgs = z.object({
  staged: z.boolean().optional().describe('Show the staged (index) diff instead of the working-tree diff.'),
  paths:  z.array(z.string()).optional().describe('Optional: restrict diff to these paths.'),
})

const gitAddArgs = z.object({
  paths: z.array(z.string()).min(1).describe('Literal repo-relative paths to stage.'),
})

const gitRemoveArgs = z.object({
  paths: z.array(z.string()).min(1).describe('Literal repo-relative paths to remove.'),
})

const gitCommitArgs = z.object({
  message: z.string().min(1).describe('Commit message (first line is the subject).'),
})

const pullRequestCreateArgs = z.object({
  title: z.string().optional().describe('Optional PR title. Defaults to "[<ticket-id>] <ticket title>".'),
  body:  z.string().optional().describe('Optional PR body. Defaults to a summary pointing at the ticket.'),
})

// ── Handlers ──

async function handleGitStatus(ctx: GithubCtx, _args: z.infer<typeof gitStatusArgs>) {
  const r = await gitExec(ctx.workDir, ['status', '--porcelain=v1'])
  if (r.exitCode !== 0) return { error: r.stderr }
  return { status: r.stdout }
}

async function handleGitDiff(ctx: GithubCtx, args: z.infer<typeof gitDiffArgs>) {
  const diffArgs = ['diff']
  if (args.staged) diffArgs.push('--cached')
  if (args.paths && args.paths.length > 0) diffArgs.push('--', ...args.paths)
  const r = await gitExec(ctx.workDir, diffArgs)
  if (r.exitCode !== 0) return { error: r.stderr }
  return { diff: r.stdout }
}

async function handleGitAdd(ctx: GithubCtx, args: z.infer<typeof gitAddArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const r = await gitExec(ctx.workDir, ['add', '--', ...args.paths])
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, staged: args.paths }
}

async function handleGitRemove(ctx: GithubCtx, args: z.infer<typeof gitRemoveArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const r = await gitExec(ctx.workDir, ['rm', '-r', '--', ...args.paths])
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, removed: args.paths }
}

async function handleGitCommit(ctx: GithubCtx, args: z.infer<typeof gitCommitArgs>) {
  const clean = await succeeds(() => execFileAsync('git', ['-C', ctx.workDir, 'diff', '--cached', '--quiet']))
  if (clean) return { ok: false, error: 'nothing staged — call gitAdd first' }

  const fullMessage = `${args.message}\n\nSession: ${ctx.sessionId}\nTicket:  ${ctx.ticket.id}\n`
  const r = await gitExec(ctx.workDir, ['commit', '-m', fullMessage])
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }

  const head = await gitExec(ctx.workDir, ['rev-parse', 'HEAD'])
  return { ok: true, commit: head.stdout.trim() }
}

async function handlePullRequestCreate(ctx: GithubCtx, args: z.infer<typeof pullRequestCreateArgs>) {
  const baseRef = await gitExec(ctx.workDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  const baseBranch = baseRef.exitCode === 0
    ? baseRef.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
    : 'main'

  const ahead = await gitExec(ctx.workDir, ['rev-list', '--count', `${baseBranch}..HEAD`])
  if (ahead.exitCode !== 0 || toInt(ahead.stdout) === 0) {
    return { ok: false, error: 'no commits to publish — call gitCommit first' }
  }

  try {
    const proj = require(database.projectGet(ctx.db, ctx.ticket.project_id), `project ${ctx.ticket.project_id} not found`)
    if (!proj.repo) return { ok: false, error: 'project has no repo configured' }
    const { owner, name } = parseRepo(proj.repo)

    // Fresh install token for the push; the clone-time token was stripped
    // and is likely near expiry.
    const pushUrl = await repoCloneUrl(ctx.config, owner, name)
    const branch = `foundry/${ctx.sessionId}`
    const push = await gitExec(ctx.workDir, ['push', pushUrl, `HEAD:refs/heads/${branch}`])
    if (push.exitCode !== 0) return { ok: false, error: push.stderr || push.stdout }

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)

    const prUrl = await githubPullRequestCreate(ctx.config, owner, name, {
      title, head: branch, base: baseBranch, body, draft: true,
    })

    domain.commentCreate(ctx.db, ctx.ticket.id, {
      author:     ctx.agentName,
      body:       `Draft PR opened: ${prUrl}`,
      session_id: ctx.sessionId,
    })

    const result: PublishResult = { branch, prUrl }
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function defaultPrBody(sessionId: string, ticket: Ticket): string {
  const body = ticket.body.trim()
  const excerpt = body.length > 800 ? `${body.slice(0, 800)}…` : body
  return `Opened automatically by Foundry session \`${sessionId}\` for ticket \`${ticket.id}\`.

**Ticket:** ${ticket.title.trim() || '(no title)'}

> ${excerpt.replace(/\n/g, '\n> ')}

This PR is a draft. Review the diff and mark it Ready when you're satisfied.`
}

const DESC = {
  gitStatus:         'Show the working tree status in porcelain format.',
  gitDiff:           'Show the diff. By default shows unstaged changes; set staged=true to see the staged diff. Optionally scope to specific paths.',
  gitAdd:            'Stage specific paths for commit. Only literal repo-relative paths are accepted — no -A, no wildcards, no glob expansion. Paths inside .git/, .foundry/, node_modules/, build outputs, and caches are rejected.',
  gitRemove:         'Remove paths from the working tree and index (git rm). Same validation as gitAdd — literal paths only, protected directories rejected.',
  gitCommit:         'Commit the staged index with a message. Fails if nothing is staged.',
  pullRequestCreate: 'Push the session branch and open a draft pull request against the clone\'s default branch. Call after gitCommit. Posts a comment on the current ticket with the PR URL.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: GithubCtx) {
  return createSdkMcpServer({
    name: 'github',
    tools: [
      sdkTool('gitStatus',         DESC.gitStatus,         gitStatusArgs.shape,         async a => asText(await handleGitStatus(ctx, a))),
      sdkTool('gitDiff',           DESC.gitDiff,           gitDiffArgs.shape,           async a => asText(await handleGitDiff(ctx, a))),
      sdkTool('gitAdd',            DESC.gitAdd,            gitAddArgs.shape,            async a => asText(await handleGitAdd(ctx, a))),
      sdkTool('gitRemove',         DESC.gitRemove,         gitRemoveArgs.shape,         async a => asText(await handleGitRemove(ctx, a))),
      sdkTool('gitCommit',         DESC.gitCommit,         gitCommitArgs.shape,         async a => asText(await handleGitCommit(ctx, a))),
      sdkTool('pullRequestCreate', DESC.pullRequestCreate, pullRequestCreateArgs.shape, async a => asText(await handlePullRequestCreate(ctx, a))),
    ],
  })
}

// ── Vercel ai SDK adapter ──

export function buildAi(ctx: GithubCtx) {
  return {
    gitStatus: tool({
      description: DESC.gitStatus,
      inputSchema: gitStatusArgs,
      execute:     (args: z.infer<typeof gitStatusArgs>) => handleGitStatus(ctx, args),
    }),
    gitDiff: tool({
      description: DESC.gitDiff,
      inputSchema: gitDiffArgs,
      execute:     (args: z.infer<typeof gitDiffArgs>) => handleGitDiff(ctx, args),
    }),
    gitAdd: tool({
      description: DESC.gitAdd,
      inputSchema: gitAddArgs,
      execute:     (args: z.infer<typeof gitAddArgs>) => handleGitAdd(ctx, args),
    }),
    gitRemove: tool({
      description: DESC.gitRemove,
      inputSchema: gitRemoveArgs,
      execute:     (args: z.infer<typeof gitRemoveArgs>) => handleGitRemove(ctx, args),
    }),
    gitCommit: tool({
      description: DESC.gitCommit,
      inputSchema: gitCommitArgs,
      execute:     (args: z.infer<typeof gitCommitArgs>) => handleGitCommit(ctx, args),
    }),
    pullRequestCreate: tool({
      description: DESC.pullRequestCreate,
      inputSchema: pullRequestCreateArgs,
      execute:     (args: z.infer<typeof pullRequestCreateArgs>) => handlePullRequestCreate(ctx, args),
    }),
  }
}
