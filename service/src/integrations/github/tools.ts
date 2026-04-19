// GitHub development-flow server. Git is a peer integration like any other
// MCP server — the agent is responsible for populating the workspace via
// gitClone, making changes, and publishing via gitPullRequest. The
// framework provides an empty workspace at /work and nothing else.
//
// Execution model:
//
//   gitClone runs in a TIER-2 sandbox: fresh container, /work mounted
//   read-write, INSTALL_TOKEN read from a mounted secret file, network
//   enabled. After clone completes, the embedded token is stripped from
//   .git/config so subsequent tier-1 calls can't read it.
//
//   gitStatus/gitDiff/gitAdd/gitRemove/gitCommit run in the SESSION
//   sandbox (tier-1) via runCommand — same model as exec/read/write.
//   They need only filesystem access to /work; no credentials, no
//   network. Get execution rows like every other tool.
//
//   gitPullRequest runs in a TIER-2 sandbox: /work mounted read-only,
//   fresh install token in env, network enabled. Pushes the session
//   branch and calls the GitHub PR create API. Token dies with the
//   container.
//
// Workspace lifecycle is minimal: workspaceEmpty() creates a tmpdir,
// workspaceDestroy() removes it. Both host-side. Everything in between
// is agent-driven via tools.

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { z } from 'zod'

import type { Db } from '../../core/db.js'
import * as database from '../../core/db.js'
import type { Config } from '../../core/config.js'
import type { Ticket } from '../../core/schema.js'
import { mustExist, toInt } from '../../core/util.js'
import { installationForRepo, installationToken } from './provider.js'
import { runCommand } from '../shared.js'

import type { McpServerInfo, ToolDef } from '../types.js'

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

// Resolve the project's configured repo. Throws if unset — callers catch
// and return `{ ok: false, error }`.
function ticketRepo(ctx: GithubCtx): { owner: string; name: string } {
  const proj = mustExist(database.projectGet(ctx.db, ctx.ticket.project_id), `project ${ctx.ticket.project_id} not found`)
  if (!proj.repo) throw new Error('project has no repo configured')
  return parseRepo(proj.repo)
}

const errMsg = (err: unknown) => err instanceof Error ? err.message : String(err)

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
// gitPullRequest's tier-2 path which targets foundry/<sessionId> only.
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
  toolUseId?: string
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

const gitPullRequestArgs = z.object({
  title: z.string().optional().describe('Optional PR title. Defaults to "[<ticket-id>] <ticket title>".'),
  body:  z.string().optional().describe('Optional PR body. Defaults to a summary pointing at the ticket.'),
  draft: z.boolean().optional().describe('If true, open as a draft PR. Default: false (ready for review).'),
})

const gitRebaseArgs = z.object({})

const gitMergeArgs = z.object({
  title: z.string().optional().describe('Optional PR title. Defaults to "[<ticket-id>] <ticket title>".'),
  body:  z.string().optional().describe('Optional PR body. Defaults to a summary pointing at the ticket.'),
})

// ── gitClone: tier-2 sandbox (install token isolated from the agent) ──

async function handleGitClone(ctx: GithubCtx, args: z.infer<typeof gitCloneArgs>) {
  try {
    const fallback = args.owner && args.repo ? null : ticketRepo(ctx)
    const owner = args.owner ?? fallback!.owner
    const name  = args.repo  ?? fallback!.name
    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)
    const branch = `foundry/${ctx.sessionId}`

    const command = [
      'set -e',
      'export GIT_TERMINAL_PROMPT=0',
      'INSTALL_TOKEN="$(cat /foundry-secrets/install-token)"',
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
          OWNER:         owner,
          REPO:          name,
          SESSION_ID:    ctx.sessionId,
        },
        secretFiles: { 'install-token': installToken },
        toolUseId: ctx.toolUseId,
      })

    if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout || 'clone failed' }
    return { ok: true, owner, repo: name, branch }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

// ── Handlers (tier-1 git ops run in the session sandbox) ──

async function handleGitStatus(ctx: GithubCtx, _args: z.infer<typeof gitStatusArgs>) {
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    'git status --porcelain=v1', 'gitStatus', {}, { toolUseId: ctx.toolUseId })
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
    parts.join(' '), 'gitDiff', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout }
  return { diff: r.stdout }
}

async function handleGitAdd(ctx: GithubCtx, args: z.infer<typeof gitAddArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
  const command = `git add -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitAdd', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, staged: args.paths }
}

async function handleGitRemove(ctx: GithubCtx, args: z.infer<typeof gitRemoveArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
  const command = `git rm -r -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitRemove', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, removed: args.paths }
}

async function handleGitCommit(ctx: GithubCtx, args: z.infer<typeof gitCommitArgs>) {
  const fullMessage = `${args.message}\n\nSession: ${ctx.sessionId}\nTicket:  ${ctx.ticket.id}\n`
  const command = [
    'set -e',
    'if git diff --cached --quiet; then',
    '  echo NOTHING_STAGED',
    '  exit 64',
    'fi',
    'git commit -m "$FULL_MSG" 1>&2',
    'git rev-parse HEAD',
  ].join('\n')
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, 'gitCommit', args, { env: { FULL_MSG: fullMessage }, toolUseId: ctx.toolUseId })
  if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_STAGED') {
    return { ok: false, error: 'nothing staged — call gitAdd first' }
  }
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  const sha = r.stdout.trim().split('\n').pop() ?? ''
  return { ok: true, commit: sha }
}

async function handleGitPullRequest(ctx: GithubCtx, args: z.infer<typeof gitPullRequestArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)
    const branch = `foundry/${ctx.sessionId}`

    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)

    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      'INSTALL_TOKEN="$(cat /foundry-secrets/install-token)"',
      'BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||" || echo main)',
      'AHEAD=$(git rev-list --count "${BASE}..HEAD")',
      'if [ "$AHEAD" -eq 0 ]; then',
      '  echo NOTHING_TO_PUBLISH',
      '  exit 64',
      'fi',
      'PR_BODY=$(printf \'%s\' "${PR_BODY_JSON}" | jq --arg b "$BASE" \'.base = $b\')',
      'git push "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" "HEAD:refs/heads/${BRANCH}" 1>&2',
      'printf \'%s\' "$PR_BODY" | curl -sS -w "\\n%{http_code}" -X POST \\',
      '  -H "Authorization: Bearer ${INSTALL_TOKEN}" \\',
      '  -H "Accept: application/vnd.github+json" \\',
      '  -H "Content-Type: application/json" \\',
      '  --data-binary @- \\',
      '  "https://api.github.com/repos/${OWNER}/${REPO}/pulls"',
    ].join('\n')

    const draft = args.draft ?? false
    const prBodyTemplate = JSON.stringify({ title, head: branch, base: 'main', body, draft })

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitPullRequest', {}, {
        network: true,
        mount:   'ro',
        env: {
          OWNER:         owner,
          REPO:          name,
          BRANCH:        branch,
          PR_BODY_JSON:  prBodyTemplate,
        },
        secretFiles: { 'install-token': installToken },
        toolUseId: ctx.toolUseId,
      })

    if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
      return { ok: false, error: 'no commits to publish — call gitCommit first' }
    }
    if (r.exitCode !== 0) {
      return { ok: false, error: 'push or PR create failed (see execution row for details)' }
    }

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
      if (!parsed.html_url) throw new Error('missing html_url in response')
      prUrl = parsed.html_url
    } catch (err) {
      return { ok: false, error: `PR create response not parseable: ${errMsg(err)}` }
    }

    const result: PublishResult = { branch, prUrl }
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

// ── gitRebase: fetch latest main + rebase session branch ──

async function handleGitRebase(ctx: GithubCtx, _args: z.infer<typeof gitRebaseArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)

    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      'INSTALL_TOKEN="$(cat /foundry-secrets/install-token)"',
      'git fetch "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" main:refs/remotes/origin/main 1>&2',
      'git rebase origin/main 1>&2',
      'echo ok',
    ].join('\n')

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitRebase', {}, {
        network: true,
        mount:   'rw',
        env: {
          OWNER: owner,
          REPO:  name,
        },
        secretFiles: { 'install-token': installToken },
        toolUseId: ctx.toolUseId,
      })

    if (r.exitCode !== 0) {
      return { ok: false, error: `rebase failed: ${r.stderr || r.stdout}`.slice(0, 500) }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

async function handleGitMerge(ctx: GithubCtx, args: z.infer<typeof gitMergeArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)
    const branch = `foundry/${ctx.sessionId}`

    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)

    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      'INSTALL_TOKEN="$(cat /foundry-secrets/install-token)"',
      'BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||" || echo main)',
      'AHEAD=$(git rev-list --count "${BASE}..HEAD")',
      'if [ "$AHEAD" -eq 0 ]; then',
      '  echo NOTHING_TO_PUBLISH',
      '  exit 64',
      'fi',
      'PR_BODY=$(printf \'%s\' "${PR_BODY_JSON}" | jq --arg b "$BASE" \'.base = $b\')',
      'git push "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" "HEAD:refs/heads/${BRANCH}" 1>&2',
      'printf \'%s\' "$PR_BODY" | curl -sS -w "\\n%{http_code}" -X POST \\',
      '  -H "Authorization: Bearer ${INSTALL_TOKEN}" \\',
      '  -H "Accept: application/vnd.github+json" \\',
      '  -H "Content-Type: application/json" \\',
      '  --data-binary @- \\',
      '  "https://api.github.com/repos/${OWNER}/${REPO}/pulls"',
    ].join('\n')

    const prBodyTemplate = JSON.stringify({ title, head: branch, base: 'main', body, draft: false })

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitMerge', {}, {
        network: true,
        mount:   'ro',
        env: {
          OWNER:         owner,
          REPO:          name,
          BRANCH:        branch,
          PR_BODY_JSON:  prBodyTemplate,
        },
        secretFiles: { 'install-token': installToken },
        toolUseId: ctx.toolUseId,
      })

    if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
      return { ok: false, error: 'no commits to publish — call gitCommit first' }
    }
    if (r.exitCode !== 0) {
      return { ok: false, error: 'push or PR create failed (see execution row for details)' }
    }

    const lines = r.stdout.trim().split('\n')
    const statusLine = lines[lines.length - 1] ?? ''
    const jsonBody   = lines.slice(0, -1).join('\n')
    const status = toInt(statusLine)

    let prUrl: string
    let prNumber: number

    if (status === 201) {
      try {
        const parsed = JSON.parse(jsonBody) as { html_url?: string; number?: number }
        if (!parsed.html_url || !parsed.number) throw new Error('missing html_url or number')
        prUrl = parsed.html_url
        prNumber = parsed.number
      } catch (err) {
        return { ok: false, error: `PR response not parseable: ${errMsg(err)}` }
      }
    } else if (status === 422 && jsonBody.includes('already exists')) {
      const lookupRes = await fetch(
        `https://api.github.com/repos/${owner}/${name}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
        { headers: { Authorization: `Bearer ${installToken}`, Accept: 'application/vnd.github+json' } },
      )
      if (!lookupRes.ok) return { ok: false, error: `PR lookup failed: ${lookupRes.status}` }
      const prs = await lookupRes.json() as Array<{ html_url: string; number: number }>
      if (!prs.length) return { ok: false, error: 'PR reported as existing but not found via API' }
      prUrl = prs[0].html_url
      prNumber = prs[0].number
    } else {
      return { ok: false, error: `PR create returned HTTP ${status}: ${jsonBody.slice(0, 500)}` }
    }

    const mergeRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        headers: {
          Authorization:  `Bearer ${installToken}`,
          Accept:         'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ merge_method: 'merge' }),
      },
    )
    if (!mergeRes.ok) {
      const mergeErr = await mergeRes.text().catch(() => '')
      return { ok: false, error: `merge failed (HTTP ${mergeRes.status}): ${mergeErr.slice(0, 300)}. PR is open at ${prUrl} — resolve conflicts and merge manually, or call gitRebase and retry.` }
    }

    return { ok: true, merged: true, branch, prUrl }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

function defaultPrBody(sessionId: string, ticket: Ticket): string {
  const body = ticket.description.trim()
  const excerpt = body.length > 800 ? `${body.slice(0, 800)}…` : body
  return `Opened automatically by Foundry session \`${sessionId}\` for ticket \`${ticket.id}\`.

**Ticket:** ${ticket.title.trim() || '(no title)'}

> ${excerpt.replace(/\n/g, '\n> ')}

This PR is a draft. Review the diff and mark it Ready when you're satisfied.`
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'github',
  name:        'GitHub',
  category:    'code',
  description: 'Development flow against a configured GitHub repo: clone, inspect, stage, commit, open draft PRs.',
}

export const tools: ToolDef[] = [
  { name: 'gitClone',       description: 'Clone the configured GitHub repo into the empty session workspace at /work. Creates the per-session branch `foundry/<session-id>` and switches to it. Typical first step of a code session — the workspace starts empty, nothing is pre-cloned. Optional owner/repo args override the project default if you need a different repo.', schema: gitCloneArgs, handler: handleGitClone },
  { name: 'gitStatus',      description: 'Show the working tree status in porcelain format. Requires a workspace populated by gitClone (or manually) — fails if /work is not a git repo.',                                                                                                                                                                                    schema: gitStatusArgs, handler: handleGitStatus },
  { name: 'gitDiff',        description: 'Show the diff. By default shows unstaged changes; set staged=true to see the staged diff. Optionally scope to specific paths. Requires a git workspace (see gitClone).',                                                                                                                                                             schema: gitDiffArgs, handler: handleGitDiff },
  { name: 'gitAdd',         description: 'Stage specific paths for commit. Only literal repo-relative paths are accepted — no -A, no wildcards, no glob expansion. Paths inside .git/, .foundry/, node_modules/, build outputs, and caches are rejected. Requires a git workspace (see gitClone).',                                                                             schema: gitAddArgs, handler: handleGitAdd },
  { name: 'gitRemove',      description: 'Remove paths from the working tree and index (git rm). Same validation as gitAdd — literal paths only, protected directories rejected. Requires a git workspace (see gitClone).',                                                                                                                                                    schema: gitRemoveArgs, handler: handleGitRemove },
  { name: 'gitCommit',      description: 'Commit the staged index with a message. Fails if nothing is staged. Session id and ticket id are appended to the commit trailer automatically. Requires a git workspace (see gitClone).',                                                                                                                                            schema: gitCommitArgs, handler: handleGitCommit },
  { name: 'gitPullRequest', description: 'Push the session branch and open a pull request against the clone\'s default branch. The PR is NOT merged — a human reviews and merges it. Use this when review is wanted before landing. Pass draft:true to mark as draft. Call after at least one gitCommit. Posts a "PR opened" comment on the ticket. Requires a git workspace (see gitClone).', schema: gitPullRequestArgs, handler: handleGitPullRequest },
  { name: 'gitMerge',       description: 'Push the session branch, open a PR, and merge it immediately to the default branch. This is the trunk-based tool — code lands on main in one call. Fails with an error if there\'s a merge conflict (the PR is left open for manual resolution or gitRebase). Call after at least one gitCommit. Posts a "Merged" comment on the ticket. Requires a git workspace (see gitClone).', schema: gitMergeArgs, handler: handleGitMerge },
  { name: 'gitRebase',      description: 'Fetch latest main from origin and rebase the session branch on top of it. Use this after gitMerge fails due to a merge conflict — rebase resolves the conflict by replaying your commits on the latest main, then retry gitMerge. If the rebase itself has conflicts that git cannot auto-resolve, this tool fails with the conflict details. Requires a git workspace (see gitClone).', schema: gitRebaseArgs, handler: handleGitRebase },
]
