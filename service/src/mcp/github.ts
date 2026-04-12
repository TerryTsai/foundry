// GitHub development-flow server. Git is a peer integration like any other
// MCP server — the agent is responsible for populating the workspace via
// gitClone, making changes, and publishing via pullRequestCreate. The
// framework provides an empty workspace at /work and nothing else.
//
// Execution model:
//
//   gitClone runs in a TIER-2 sandbox: fresh container, /work mounted
//   read-write, INSTALL_TOKEN injected as an env var, network enabled.
//   After clone completes, the embedded token is stripped from
//   .git/config so subsequent tier-1 calls can't read it.
//
//   gitStatus/gitDiff/gitAdd/gitRemove/gitCommit run in the SESSION
//   sandbox (tier-1) via runCommand — same model as exec/read/write.
//   They need only filesystem access to /work; no credentials, no
//   network. Get execution rows like every other tool.
//
//   pullRequestCreate runs in a TIER-2 sandbox: /work mounted read-only,
//   fresh install token in env, network enabled. Pushes the session
//   branch and calls the GitHub PR create API. Token dies with the
//   container.
//
// Workspace lifecycle is minimal: workspaceEmpty() creates a tmpdir,
// workspaceDestroy() removes it. Both host-side. Everything in between
// is agent-driven.

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
import { require, toInt } from '../functional.js'
import { installationForRepo, installationToken } from '../github.js'
import { asText, runCommand } from './_shared.js'

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'github',
  name:        'GitHub',
  description: 'Development flow against a configured GitHub repo: clone, inspect, stage, commit, open draft PRs.',
  tools: [
    { name: 'gitClone',          description: 'Clone the configured GitHub repo into the empty session workspace and create the per-session branch. First step of a code session.' },
    { name: 'gitStatus',         description: 'Show the working tree status (porcelain format).' },
    { name: 'gitDiff',           description: 'Show the working-tree or staged diff, optionally scoped to paths.' },
    { name: 'gitAdd',            description: 'Stage specific paths for commit. Literal paths only — no -A, no wildcards.' },
    { name: 'gitRemove',         description: 'Remove paths from the working tree and index (git rm).' },
    { name: 'gitCommit',         description: 'Commit the staged index with a message.' },
    { name: 'pullRequestCreate', description: 'Push the session branch and open a draft pull request.' },
  ],
}

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE LIFECYCLE (host-side)
// ════════════════════════════════════════════════════════════════════════════
// The only framework-level workspace operations. workspaceEmpty is called by
// the runner at session start; workspaceDestroy is called in the finally
// block after the session ends. Everything else is agent-driven via tools.

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

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLS
// ════════════════════════════════════════════════════════════════════════════

// Paths the agent may never stage — known garbage directories that have
// caused incidents (RCA-001) or that are structurally host-only. First
// segment of the path is checked against this list. Guidance, not security:
// an agent could still bypass via `exec git add -A`. The hard guarantee is
// that such commits can't reach origin/main because push goes through
// pullRequestCreate's tier-2 path which targets foundry/<sessionId> only.
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

// POSIX-safe single-quote escape for paths passed through the shell.
function esc(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export interface GithubCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string   // same tmpdir the sandbox server bind-mounts at /work
  ticket:    Ticket
  agentName: string
}

// ── Schemas ──

const gitCloneArgs = z.object({
  owner: z.string().optional().describe('Optional GitHub owner. Defaults to the project\'s configured repo.'),
  repo:  z.string().optional().describe('Optional GitHub repo name. Defaults to the project\'s configured repo.'),
})

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

// ── gitClone: tier-2 sandbox (install token isolated from the agent) ──
//
// Resolves the target repo (default = project.repo), mints a fresh
// installation token on the host, spawns a tier-2 container with the
// token in env, clones into /work (mounted rw), strips the token from
// .git/config, sets the Foundry git identity, and creates the per-session
// branch foundry/<sessionId>. The tier-1 containers that the agent later
// uses can read the populated /work but the token lived only in the
// tier-2 env and the initial .git/config — both gone by the time any
// tier-1 call runs.

async function handleGitClone(ctx: GithubCtx, args: z.infer<typeof gitCloneArgs>) {
  // Resolve owner/repo: explicit args win, otherwise fall back to project.repo.
  let owner = args.owner
  let name  = args.repo
  if (!owner || !name) {
    const proj = require(database.projectGet(ctx.db, ctx.ticket.project_id), `project ${ctx.ticket.project_id} not found`)
    if (!proj.repo) return { ok: false, error: 'no owner/repo provided and project has no default repo configured' }
    const parsed = parseRepo(proj.repo)
    owner = owner ?? parsed.owner
    name  = name  ?? parsed.name
  }

  try {
    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)
    const branch = `foundry/${ctx.sessionId}`

    // Single-shot command: clone (into /work, which is the bind-mounted
    // session workspace), scrub the embedded token from .git/config,
    // set identity, create the session branch. All five steps in one
    // tier-2 container so the token never persists past this call.
    const command = [
      'set -e',
      'export GIT_TERMINAL_PROMPT=0',
      'git clone "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" /work 1>&2',
      'git -C /work remote set-url origin "https://github.com/${OWNER}/${REPO}.git"',
      'git -C /work config user.email foundry@localhost',
      'git -C /work config user.name Foundry',
      'git -C /work checkout -b "foundry/${SESSION_ID}" 1>&2',
      'echo cloned',
    ].join('\n')

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitClone', { owner, repo: name }, {
        network: true,
        mount:   'rw',
        env: {
          INSTALL_TOKEN: installToken,
          OWNER:         owner,
          REPO:          name,
          SESSION_ID:    ctx.sessionId,
        },
      })

    if (r.exitCode !== 0) {
      return { ok: false, error: r.stderr || r.stdout || 'clone failed' }
    }
    return { ok: true, owner, repo: name, branch }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Handlers (tier-1 git ops run in the session sandbox) ──

async function handleGitStatus(ctx: GithubCtx, _args: z.infer<typeof gitStatusArgs>) {
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'git status --porcelain=v1', 'gitStatus', {})
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout }
  return { status: r.stdout }
}

async function handleGitDiff(ctx: GithubCtx, args: z.infer<typeof gitDiffArgs>) {
  const parts = ['git', 'diff']
  if (args.staged) parts.push('--cached')
  if (args.paths && args.paths.length > 0) {
    parts.push('--')
    for (const p of args.paths) parts.push(esc(p))
  }
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    parts.join(' '), 'gitDiff', args)
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout }
  return { diff: r.stdout }
}

async function handleGitAdd(ctx: GithubCtx, args: z.infer<typeof gitAddArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const command = `git add -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitAdd', args)
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, staged: args.paths }
}

async function handleGitRemove(ctx: GithubCtx, args: z.infer<typeof gitRemoveArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const command = `git rm -r -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitRemove', args)
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, removed: args.paths }
}

async function handleGitCommit(ctx: GithubCtx, args: z.infer<typeof gitCommitArgs>) {
  const fullMessage = `${args.message}\n\nSession: ${ctx.sessionId}\nTicket:  ${ctx.ticket.id}\n`
  // Pre-flight: check there's something staged. git diff --cached --quiet
  // exits 0 if index is clean, non-zero if staged changes exist. Invert.
  const check = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'git diff --cached --quiet', 'gitCommit', { phase: 'check' })
  if (check.exitCode === 0) return { ok: false, error: 'nothing staged — call gitAdd first' }

  // Commit + capture the resulting HEAD sha.
  const command = `git commit -m ${esc(fullMessage)} && git rev-parse HEAD`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitCommit', args)
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  const lines = r.stdout.trim().split('\n')
  return { ok: true, commit: lines[lines.length - 1] }
}

// ── pullRequestCreate: tier-2 sandbox (push + PR create with secret) ──

async function handlePullRequestCreate(ctx: GithubCtx, args: z.infer<typeof pullRequestCreateArgs>) {
  // Pre-flight (tier-1): verify there are commits to publish.
  const baseRefCheck = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'git symbolic-ref refs/remotes/origin/HEAD', 'pullRequestCreate', { phase: 'base' })
  const baseBranch = baseRefCheck.exitCode === 0
    ? baseRefCheck.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
    : 'main'

  const aheadCheck = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    `git rev-list --count ${esc(baseBranch)}..HEAD`, 'pullRequestCreate', { phase: 'ahead' })
  if (aheadCheck.exitCode !== 0 || toInt(aheadCheck.stdout) === 0) {
    return { ok: false, error: 'no commits to publish — call gitCommit first' }
  }

  try {
    const proj = require(database.projectGet(ctx.db, ctx.ticket.project_id), `project ${ctx.ticket.project_id} not found`)
    if (!proj.repo) return { ok: false, error: 'project has no repo configured' }
    const { owner, name } = parseRepo(proj.repo)
    const branch = `foundry/${ctx.sessionId}`

    // Mint a fresh installation token just before the push. Token lives
    // for ~1 hour, but we only need seconds of it. Host process holds the
    // App private key; the sandbox never sees it.
    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)
    const prBody = JSON.stringify({ title, head: branch, base: baseBranch, body, draft: true })

    // Combined push + PR-create command. All credential values come from
    // env vars injected by podman; the logged command string contains
    // only variable references ($INSTALL_TOKEN etc), not the expanded
    // secrets. The shell inside the container expands them at run time.
    // Any token that leaks into git's stderr is scrubbed before write by
    // the execution-row scrubber in mcp/_shared.ts.
    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      'git push "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" "HEAD:refs/heads/${BRANCH}" 1>&2',
      'printf \'%s\' "${PR_BODY_JSON}" | curl -sS -w "\\n%{http_code}" -X POST \\',
      '  -H "Authorization: Bearer ${INSTALL_TOKEN}" \\',
      '  -H "Accept: application/vnd.github+json" \\',
      '  -H "Content-Type: application/json" \\',
      '  --data-binary @- \\',
      '  "https://api.github.com/repos/${OWNER}/${REPO}/pulls"',
    ].join('\n')

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'pullRequestCreate', { phase: 'publish' }, {
        network: true,
        mount:   'ro',
        env: {
          INSTALL_TOKEN: installToken,
          OWNER:         owner,
          REPO:          name,
          BRANCH:        branch,
          BASE:          baseBranch,
          PR_BODY_JSON:  prBody,
        },
      })

    if (r.exitCode !== 0) {
      return { ok: false, error: 'push or PR create failed (see execution row for details)' }
    }

    // Parse stdout: last line = HTTP status, rest = JSON body.
    const lines = r.stdout.trim().split('\n')
    const statusLine = lines[lines.length - 1] ?? ''
    const jsonBody   = lines.slice(0, -1).join('\n')
    const status = toInt(statusLine)
    if (status !== 201) {
      return { ok: false, error: `PR create returned HTTP ${status}: ${jsonBody.slice(0, 500)}` }
    }
    let prUrl: string
    try {
      const parsed = JSON.parse(jsonBody) as { html_url?: string }
      if (!parsed.html_url) throw new Error('no html_url in response')
      prUrl = parsed.html_url
    } catch (err) {
      return { ok: false, error: `PR create response not parseable: ${err instanceof Error ? err.message : String(err)}` }
    }

    // Post a ticket comment with the PR URL so the founder can find it.
    const { commentCreate } = await import('../domain.js')
    commentCreate(ctx.db, ctx.ticket.id, {
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

// Tool descriptions carry the environmental contract each tool expects
// and produces, so the agent doesn't need a separate "here's your
// environment" preamble at the top of the system prompt. The tool
// descriptions ARE the environmental documentation.
const DESC = {
  gitClone:          'Clone the configured GitHub repo into the empty session workspace at /work. Creates the per-session branch `foundry/<session-id>` and switches to it. Typical first step of a code session — the workspace starts empty, nothing is pre-cloned. Optional owner/repo args override the project default if you need a different repo.',
  gitStatus:         'Show the working tree status in porcelain format. Requires a workspace populated by gitClone (or manually) — fails if /work is not a git repo.',
  gitDiff:           'Show the diff. By default shows unstaged changes; set staged=true to see the staged diff. Optionally scope to specific paths. Requires a git workspace (see gitClone).',
  gitAdd:            'Stage specific paths for commit. Only literal repo-relative paths are accepted — no -A, no wildcards, no glob expansion. Paths inside .git/, .foundry/, node_modules/, build outputs, and caches are rejected. Requires a git workspace (see gitClone).',
  gitRemove:         'Remove paths from the working tree and index (git rm). Same validation as gitAdd — literal paths only, protected directories rejected. Requires a git workspace (see gitClone).',
  gitCommit:         'Commit the staged index with a message. Fails if nothing is staged. Session id and ticket id are appended to the commit trailer automatically. Requires a git workspace (see gitClone).',
  pullRequestCreate: 'Push the session branch and open a draft pull request against the clone\'s default branch. Call after at least one gitCommit. Posts a comment on the current ticket with the PR URL. Requires a git workspace (see gitClone).',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: GithubCtx) {
  return createSdkMcpServer({
    name: 'github',
    tools: [
      sdkTool('gitClone',          DESC.gitClone,          gitCloneArgs.shape,          async a => asText(await handleGitClone(ctx, a))),
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
    gitClone: tool({
      description: DESC.gitClone,
      inputSchema: gitCloneArgs,
      execute:     (args: z.infer<typeof gitCloneArgs>) => handleGitClone(ctx, args),
    }),
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
