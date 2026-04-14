// GitHub development-flow server. Git is a peer integration like any other
// MCP server — the agent is responsible for populating the workspace via
// gitClone, making changes, and publishing via gitPullRequest. The
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
//   gitPullRequest runs in a TIER-2 sandbox: /work mounted read-only,
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
import type { Ticket } from '../tables.js'
import { mustExist, toInt } from '../util.js'
import { installationForRepo, installationToken } from '../connections/github.js'
import { asText, runCommand, toolUseId } from './shared.js'

import { filterTools, type McpServerInfo } from './registry.js'

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
    { name: 'gitPullRequest',    description: 'Push the session branch and open a pull request for review.' },
    { name: 'gitMerge',          description: 'Push the session branch, open a PR, and merge it immediately. Fails on conflict.' },
    { name: 'gitRebase',         description: 'Rebase the session branch against latest main. Use after a merge conflict.' },
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
  try {
    const fallback = args.owner && args.repo ? null : ticketRepo(ctx)
    const owner = args.owner ?? fallback!.owner
    const name  = args.repo  ?? fallback!.name
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
  // Single shell script: preflight + commit + capture HEAD. Runs in one
  // container, produces one execution row. The commit message comes in
  // via env (FULL_MSG) so we don't have to shell-escape multi-line text.
  // A NOTHING_STAGED marker with exit 64 signals "empty index" distinct
  // from a generic git failure.
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

// ── gitPullRequest: tier-2 sandbox (push + PR create with secret) ──
//
// Single container, single execution row. Does preflight (base branch
// detection + ahead count), push, and PR create all in one shell script
// inside a tier-2 container with /work mounted read-only and the install
// token in env. A NOTHING_TO_PUBLISH marker signals empty-branch distinct
// from genuine errors. The curl response body is the script's stdout,
// parsed by the handler to extract the PR URL.

async function handleGitPullRequest(ctx: GithubCtx, args: z.infer<typeof gitPullRequestArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)
    const branch = `foundry/${ctx.sessionId}`

    // Mint a fresh installation token just before the call. Token lives
    // for ~1 hour, but we only need seconds of it. Host process holds the
    // App private key; the sandbox never sees it.
    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)

    // Combined preflight + push + PR-create shell script. All credential
    // values come from env vars injected by podman; the logged command
    // string contains only variable references. The shell inside the
    // container expands them at run time. Any token that leaks into git's
    // stderr is scrubbed before write by the execution-row scrubber in
    // mcp/shared.ts.
    //
    // Output contract for the handler:
    //   - exit 64 + "NOTHING_TO_PUBLISH" on stdout → empty branch
    //   - exit 0 + JSON body + "\n<http_code>" on stdout → PR created
    //   - anything else → generic failure
    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      '# Detect the base branch (what origin/HEAD points at, default main).',
      'BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||" || echo main)',
      '# Count commits ahead of the base. If zero, nothing to publish.',
      'AHEAD=$(git rev-list --count "${BASE}..HEAD")',
      'if [ "$AHEAD" -eq 0 ]; then',
      '  echo NOTHING_TO_PUBLISH',
      '  exit 64',
      'fi',
      '# Rebuild the PR body JSON with the actual detected base branch.',
      'PR_BODY=$(printf \'%s\' "${PR_BODY_JSON}" | jq --arg b "$BASE" \'.base = $b\')',
      '# Push the session branch.',
      'git push "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" "HEAD:refs/heads/${BRANCH}" 1>&2',
      '# Create the PR. Response body on stdout, status code appended on its own line.',
      'printf \'%s\' "$PR_BODY" | curl -sS -w "\\n%{http_code}" -X POST \\',
      '  -H "Authorization: Bearer ${INSTALL_TOKEN}" \\',
      '  -H "Accept: application/vnd.github+json" \\',
      '  -H "Content-Type: application/json" \\',
      '  --data-binary @- \\',
      '  "https://api.github.com/repos/${OWNER}/${REPO}/pulls"',
    ].join('\n')

    // PR body is a JSON template with placeholder base; the shell script
    // rewrites it to the detected BASE before posting. This way we don't
    // have to round-trip the base branch out of the container first.
    const draft = args.draft ?? false
    const prBodyTemplate = JSON.stringify({ title, head: branch, base: 'main', body, draft })

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitPullRequest', {}, {
        network: true,
        mount:   'ro',
        env: {
          INSTALL_TOKEN: installToken,
          OWNER:         owner,
          REPO:          name,
          BRANCH:        branch,
          PR_BODY_JSON:  prBodyTemplate,
        },
        toolUseId: ctx.toolUseId,
      })

    // Marker exit code: nothing staged beyond the base branch.
    if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
      return { ok: false, error: 'no commits to publish — call gitCommit first' }
    }
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
      if (!parsed.html_url) throw new Error('missing html_url in response')
      prUrl = parsed.html_url
    } catch (err) {
      return { ok: false, error: `PR create response not parseable: ${errMsg(err)}` }
    }

    const { commentCreate } = await import('../domain/tickets.js')
    commentCreate(ctx.db, ctx.ticket.id, {
      author:     ctx.agentName,
      body:       `PR opened: ${prUrl}`,
      session_id: ctx.sessionId,
    })

    const result: PublishResult = { branch, prUrl }
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

// ── gitRebase: fetch latest main + rebase session branch ──
// Tier-2: needs install token to fetch from a private repo. /work
// mounted rw because rebase rewrites the session branch's commits.

async function handleGitRebase(ctx: GithubCtx, _args: z.infer<typeof gitRebaseArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)

    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
      'git fetch "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" main:refs/remotes/origin/main 1>&2',
      'git rebase origin/main 1>&2',
      'echo ok',
    ].join('\n')

    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
      command, 'gitRebase', {}, {
        network: true,
        mount:   'rw',
        env: {
          INSTALL_TOKEN: installToken,
          OWNER:         owner,
          REPO:          name,
        },
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

// ── gitMerge: push + PR + immediate merge (deterministic) ──
// Unlike gitPullRequest, this tool ALWAYS merges. If there's a conflict,
// it returns an error — it does not fall back to leaving a PR open.
// The agent knows exactly what happened: either merged or failed.

async function handleGitMerge(ctx: GithubCtx, args: z.infer<typeof gitMergeArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)
    const branch = `foundry/${ctx.sessionId}`

    const installationId = await installationForRepo(ctx.config, owner, name)
    const { token: installToken } = await installationToken(ctx.config, installationId)

    const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
    const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)

    // Same push + PR-create shell script as gitPullRequest.
    const command = [
      'set -e',
      'cd /work',
      'export GIT_TERMINAL_PROMPT=0',
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
          INSTALL_TOKEN: installToken,
          OWNER:         owner,
          REPO:          name,
          BRANCH:        branch,
          PR_BODY_JSON:  prBodyTemplate,
        },
        toolUseId: ctx.toolUseId,
      })

    if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
      return { ok: false, error: 'no commits to publish — call gitCommit first' }
    }
    if (r.exitCode !== 0) {
      return { ok: false, error: 'push or PR create failed (see execution row for details)' }
    }

    // Parse stdout: last line = HTTP status, rest = JSON body.
    // If status is 201, PR was just created. If 422, a PR already exists
    // for this branch (retry scenario) — look it up and skip to merge.
    const lines = r.stdout.trim().split('\n')
    const statusLine = lines[lines.length - 1] ?? ''
    const jsonBody   = lines.slice(0, -1).join('\n')
    const status = toInt(statusLine)

    let prUrl: string
    let prNumber: number

    if (status === 201) {
      // Fresh PR created.
      try {
        const parsed = JSON.parse(jsonBody) as { html_url?: string; number?: number }
        if (!parsed.html_url || !parsed.number) throw new Error('missing html_url or number')
        prUrl = parsed.html_url
        prNumber = parsed.number
      } catch (err) {
        return { ok: false, error: `PR response not parseable: ${errMsg(err)}` }
      }
    } else if (status === 422 && jsonBody.includes('already exists')) {
      // PR already open for this branch (retry). Look it up.
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

    // Merge the PR. This is the deterministic part — if it fails, we
    // fail the whole tool call. No fallback to "leave PR open."
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

    const { commentCreate } = await import('../domain/tickets.js')
    commentCreate(ctx.db, ctx.ticket.id, {
      author:     ctx.agentName,
      body:       `Merged: ${prUrl}`,
      session_id: ctx.sessionId,
    })

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
  gitPullRequest: 'Push the session branch and open a pull request against the clone\'s default branch. The PR is NOT merged — a human reviews and merges it. Use this when review is wanted before landing. Pass draft:true to mark as draft. Call after at least one gitCommit. Posts a "PR opened" comment on the ticket. Requires a git workspace (see gitClone).',
  gitMerge:        'Push the session branch, open a PR, and merge it immediately to the default branch. This is the trunk-based tool — code lands on main in one call. Fails with an error if there\'s a merge conflict (the PR is left open for manual resolution or gitRebase). Call after at least one gitCommit. Posts a "Merged" comment on the ticket. Requires a git workspace (see gitClone).',
  gitRebase:       'Fetch latest main from origin and rebase the session branch on top of it. Use this after gitMerge fails due to a merge conflict — rebase resolves the conflict by replaying your commits on the latest main, then retry gitMerge. If the rebase itself has conflicts that git cannot auto-resolve, this tool fails with the conflict details. Requires a git workspace (see gitClone).',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: GithubCtx, allowed?: string[] | '*' | null) {
  const tu = (x: unknown): GithubCtx => ({ ...ctx, toolUseId: toolUseId(x) })
  const all = [
    sdkTool('gitClone',       DESC.gitClone,       gitCloneArgs.shape,       async (a, x) => asText(await handleGitClone(tu(x), a))),
    sdkTool('gitStatus',      DESC.gitStatus,      gitStatusArgs.shape,      async (a, x) => asText(await handleGitStatus(tu(x), a))),
    sdkTool('gitDiff',        DESC.gitDiff,        gitDiffArgs.shape,        async (a, x) => asText(await handleGitDiff(tu(x), a))),
    sdkTool('gitAdd',         DESC.gitAdd,         gitAddArgs.shape,         async (a, x) => asText(await handleGitAdd(tu(x), a))),
    sdkTool('gitRemove',      DESC.gitRemove,      gitRemoveArgs.shape,      async (a, x) => asText(await handleGitRemove(tu(x), a))),
    sdkTool('gitCommit',      DESC.gitCommit,      gitCommitArgs.shape,      async (a, x) => asText(await handleGitCommit(tu(x), a))),
    sdkTool('gitPullRequest', DESC.gitPullRequest, gitPullRequestArgs.shape, async (a, x) => asText(await handleGitPullRequest(tu(x), a))),
    sdkTool('gitMerge',       DESC.gitMerge,       gitMergeArgs.shape,       async (a, x) => asText(await handleGitMerge(tu(x), a))),
    sdkTool('gitRebase',      DESC.gitRebase,      gitRebaseArgs.shape,      async (a, x) => asText(await handleGitRebase(tu(x), a))),
  ]
  return createSdkMcpServer({ name: 'github', tools: filterTools(all, allowed) })
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
    gitPullRequest: tool({
      description: DESC.gitPullRequest,
      inputSchema: gitPullRequestArgs,
      execute:     (args: z.infer<typeof gitPullRequestArgs>) => handleGitPullRequest(ctx, args),
    }),
    gitMerge: tool({
      description: DESC.gitMerge,
      inputSchema: gitMergeArgs,
      execute:     (args: z.infer<typeof gitMergeArgs>) => handleGitMerge(ctx, args),
    }),
    gitRebase: tool({
      description: DESC.gitRebase,
      inputSchema: gitRebaseArgs,
      execute:     (args: z.infer<typeof gitRebaseArgs>) => handleGitRebase(ctx, args),
    }),
  }
}
