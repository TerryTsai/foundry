// GitHub development-flow server. Git is a peer integration. The agent
// drives the workspace via gitClone/gitAdd/gitCommit/gitPullRequest.
// Workspace lifecycle: workspaceEmpty (host) creates a tmpdir; everything
// in between is agent-driven via tools.

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { z } from 'zod'

import type { Db, Project, Ticket } from '@foundry/db'
import { toInt } from '@foundry/model'
import type { McpConfig, ExecutionCreate, McpServerInfo, ToolDef } from '../../types.js'
import { installationForRepo, installationToken } from './provider.js'
import { runCommand } from '../shared.js'

export type GithubProjectGet = (db: Db, projectId: string) => Project | undefined

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE LIFECYCLE (host-side)
// ════════════════════════════════════════════════════════════════════════════

export interface PublishResult { branch: string; prUrl: string }

function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo.trim())
  if (!m) throw new Error(`invalid repo "${repo}" — expected "owner/name"`)
  return { owner: m[1], name: m[2] }
}

function ticketRepo(ctx: GithubCtx): { owner: string; name: string } {
  const proj = ctx.projectGet(ctx.db, ctx.ticket.project_id)
  if (!proj) throw new Error(`project ${ctx.ticket.project_id} not found`)
  if (!proj.repo) throw new Error('project has no repo configured')
  return parseRepo(proj.repo)
}

const errMsg = (errVal: unknown) => errVal instanceof Error ? errVal.message : String(errVal)

export async function workspaceEmpty(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundry-session-'))
}

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLS
// ════════════════════════════════════════════════════════════════════════════

const DENIED_PATH_PREFIXES = new Set([
  '.git', '.foundry', 'node_modules', '.npm-cache',
  'dist', 'build', 'coverage', 'target', 'vendor',
  '.cache', '.next', '.nuxt',
])

function assertSafeAddPath(p: string): void {
  assertSafeAddPathBasic(p)
  if (/[*?[\]{}]/.test(p)) throw new Error(`wildcards not allowed (pass literal paths): ${p}`)
  const first = p.split('/')[0]
  if (DENIED_PATH_PREFIXES.has(first)) throw new Error(`${first}/ paths are protected: ${p}`)
}

function assertSafeAddPathBasic(p: string): void {
  if (!p || p.trim() === '') throw new Error('path is required')
  if (p === '.' || p === '-A' || p === '--all') throw new Error(`invalid path: ${p}`)
  if (p.startsWith('/')) throw new Error(`absolute paths not allowed: ${p}`)
  if (p.split('/').includes('..')) throw new Error(`path traversal not allowed: ${p}`)
}

function esc(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export interface GithubCtx {
  db:        Db
  config:    McpConfig
  sessionId: string
  workspace: string
  ticket:    Ticket
  agentName: string
  toolUseId?: string
  executionCreate: ExecutionCreate
  projectGet:      GithubProjectGet
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

// ── gitClone: tier-2 sandbox ──

const GIT_CLONE_SCRIPT = [
  'set -e',
  'export GIT_TERMINAL_PROMPT=0',
  'git clone -q "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" /home/foundry',
  'git -C /home/foundry remote set-url origin "https://github.com/${OWNER}/${REPO}.git"',
  'git -C /home/foundry config user.email foundry@localhost',
  'git -C /home/foundry config user.name Foundry',
  'git -C /home/foundry checkout -q -b "foundry/${SESSION_ID}"',
].join('\n')

async function handleGitClone(ctx: GithubCtx, args: z.infer<typeof gitCloneArgs>) {
  try {
    const { owner, name } = resolveCloneTarget(ctx, args)
    const installToken = await fetchInstallToken(ctx.config, owner, name)
    return await execGitClone(ctx, owner, name, installToken)
  } catch (errVal) {
    return { ok: false, error: errMsg(errVal) }
  }
}

function resolveCloneTarget(ctx: GithubCtx, args: z.infer<typeof gitCloneArgs>): { owner: string; name: string } {
  if (args.owner && args.repo) return { owner: args.owner, name: args.repo }
  return ticketRepo(ctx)
}

async function fetchInstallToken(config: McpConfig, owner: string, name: string): Promise<string> {
  const installationId = await installationForRepo(config, owner, name)
  const { token } = await installationToken(config, installationId)
  return token
}

async function execGitClone(ctx: GithubCtx, owner: string, name: string, installToken: string) {
  const branch = `foundry/${ctx.sessionId}`
  const r = await runCommand(ctx, GIT_CLONE_SCRIPT, 'gitClone', { owner, repo: name }, {
    env: { OWNER: owner, REPO: name, SESSION_ID: ctx.sessionId, INSTALL_TOKEN: installToken },
    toolUseId: ctx.toolUseId,
  })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout || 'clone failed' }
  return { ok: true, owner, repo: name, branch }
}

// ── tier-1 git ops ──

async function handleGitStatus(ctx: GithubCtx, _args: z.infer<typeof gitStatusArgs>) {
  const r = await runCommand(ctx, 'git status --porcelain=v1', 'gitStatus', {}, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout }
  return { status: r.stdout }
}

async function handleGitDiff(ctx: GithubCtx, args: z.infer<typeof gitDiffArgs>) {
  const command = buildGitDiffCmd(args)
  const r = await runCommand(ctx, command, 'gitDiff', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { error: r.stderr || r.stdout }
  return { diff: r.stdout }
}

function buildGitDiffCmd(args: z.infer<typeof gitDiffArgs>): string {
  const parts = ['git', 'diff']
  if (args.staged) parts.push('--cached')
  if (args.paths && args.paths.length > 0) {
    parts.push('--')
    for (const p of args.paths) parts.push(esc(p))
  }
  return parts.join(' ')
}

async function handleGitAdd(ctx: GithubCtx, args: z.infer<typeof gitAddArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) }
  catch (errVal) { return { ok: false, error: errMsg(errVal) } }
  const command = `git add -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx, command, 'gitAdd', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, staged: args.paths }
}

async function handleGitRemove(ctx: GithubCtx, args: z.infer<typeof gitRemoveArgs>) {
  try { for (const p of args.paths) assertSafeAddPath(p) }
  catch (errVal) { return { ok: false, error: errMsg(errVal) } }
  const command = `git rm -r -- ${args.paths.map(esc).join(' ')}`
  const r = await runCommand(ctx, command, 'gitRemove', args, { toolUseId: ctx.toolUseId })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  return { ok: true, removed: args.paths }
}

const GIT_COMMIT_SCRIPT = [
  'set -e',
  'if git diff --cached --quiet; then',
  '  echo NOTHING_STAGED',
  '  exit 64',
  'fi',
  'git commit -q -m "$FULL_MSG"',
  'git rev-parse HEAD',
].join('\n')

async function handleGitCommit(ctx: GithubCtx, args: z.infer<typeof gitCommitArgs>) {
  const fullMessage = `${args.message}\n\nSession: ${ctx.sessionId}\nTicket:  ${ctx.ticket.id}\n`
  const r = await runCommand(ctx, GIT_COMMIT_SCRIPT, 'gitCommit', args, {
    env: { FULL_MSG: fullMessage }, toolUseId: ctx.toolUseId,
  })
  if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_STAGED') {
    return { ok: false, error: 'nothing staged — call gitAdd first' }
  }
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  const sha = r.stdout.trim().split('\n').pop() ?? ''
  return { ok: true, commit: sha }
}

const GIT_PR_PUSH_SCRIPT = [
  'set -e',
  'cd /home/foundry',
  'export GIT_TERMINAL_PROMPT=0',
  'BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||" || echo main)',
  'AHEAD=$(git rev-list --count "${BASE}..HEAD")',
  'if [ "$AHEAD" -eq 0 ]; then',
  '  echo NOTHING_TO_PUBLISH',
  '  exit 64',
  'fi',
  'PR_BODY=$(printf \'%s\' "${PR_BODY_JSON}" | jq --arg b "$BASE" \'.base = $b\')',
  'git push -q "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" "HEAD:refs/heads/${BRANCH}"',
  'printf \'%s\' "$PR_BODY" | curl -sS -w "\\n%{http_code}" -X POST \\',
  '  -H "Authorization: Bearer ${INSTALL_TOKEN}" \\',
  '  -H "Accept: application/vnd.github+json" \\',
  '  -H "Content-Type: application/json" \\',
  '  --data-binary @- \\',
  '  "https://api.github.com/repos/${OWNER}/${REPO}/pulls"',
].join('\n')

interface PrInputs { title: string; body: string; draft: boolean; owner: string; name: string; branch: string }

function buildPrInputs(ctx: GithubCtx, args: { title?: string; body?: string; draft?: boolean }): PrInputs {
  const { owner, name } = ticketRepo(ctx)
  const branch = `foundry/${ctx.sessionId}`
  const title = (args.title ?? `[${ctx.ticket.id}] ${ctx.ticket.title.trim() || '(no title)'}`).slice(0, 200)
  const body  = args.body ?? defaultPrBody(ctx.sessionId, ctx.ticket)
  return { title, body, draft: args.draft ?? false, owner, name, branch }
}

async function pushAndOpenPr(ctx: GithubCtx, prInputs: PrInputs, toolName: string): Promise<{ exitCode: number; stdout: string; stderr: string; installToken: string }> {
  const installToken = await fetchInstallToken(ctx.config, prInputs.owner, prInputs.name)
  const prBodyTemplate = JSON.stringify({ title: prInputs.title, head: prInputs.branch, base: 'main', body: prInputs.body, draft: prInputs.draft })
  const r = await runCommand(ctx, GIT_PR_PUSH_SCRIPT, toolName, {}, {
    env: { OWNER: prInputs.owner, REPO: prInputs.name, BRANCH: prInputs.branch, PR_BODY_JSON: prBodyTemplate, INSTALL_TOKEN: installToken },
    toolUseId: ctx.toolUseId,
  })
  return { ...r, installToken }
}

async function handleGitPullRequest(ctx: GithubCtx, args: z.infer<typeof gitPullRequestArgs>) {
  try {
    const prInputs = buildPrInputs(ctx, args)
    const r = await pushAndOpenPr(ctx, prInputs, 'gitPullRequest')
    return interpretPrResponse(r, prInputs.branch)
  } catch (errVal) {
    return { ok: false, error: errMsg(errVal) }
  }
}

function interpretPrResponse(r: { exitCode: number; stdout: string; stderr: string }, branch: string) {
  if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
    return { ok: false, error: 'no commits to publish — call gitCommit first' }
  }
  if (r.exitCode !== 0) {
    return { ok: false, error: 'push or PR create failed (see execution row for details)' }
  }
  const parsed = parsePrCreateResponse(r.stdout)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const result: PublishResult = { branch, prUrl: parsed.prUrl }
  return { ok: true, ...result }
}

function parsePrCreateResponse(stdout: string): { ok: true; prUrl: string; prNumber?: number; status: number; jsonBody: string } | { ok: false; error: string; status: number; jsonBody: string } {
  const lines = stdout.trim().split('\n')
  const statusLine = lines[lines.length - 1] ?? ''
  const jsonBody   = lines.slice(0, -1).join('\n')
  const status = toInt(statusLine)
  if (status !== 201) return { ok: false, error: `PR create returned HTTP ${status}: ${jsonBody.slice(0, 500)}`, status, jsonBody }
  return parseJsonPrUrl(jsonBody, status)
}

function parseJsonPrUrl(jsonBody: string, status: number): { ok: true; prUrl: string; prNumber?: number; status: number; jsonBody: string } | { ok: false; error: string; status: number; jsonBody: string } {
  try {
    const parsed = JSON.parse(jsonBody) as { html_url?: string; number?: number }
    if (!parsed.html_url) return { ok: false, error: 'missing html_url in response', status, jsonBody }
    return { ok: true, prUrl: parsed.html_url, prNumber: parsed.number, status, jsonBody }
  } catch (errVal) {
    return { ok: false, error: `PR create response not parseable: ${errMsg(errVal)}`, status, jsonBody }
  }
}

// ── gitRebase ──

const GIT_REBASE_SCRIPT = [
  'set -e',
  'cd /home/foundry',
  'export GIT_TERMINAL_PROMPT=0',
  'git fetch -q "https://x-access-token:${INSTALL_TOKEN}@github.com/${OWNER}/${REPO}" main:refs/remotes/origin/main',
  'git rebase -q origin/main',
].join('\n')

async function handleGitRebase(ctx: GithubCtx, _args: z.infer<typeof gitRebaseArgs>) {
  try {
    const { owner, name } = ticketRepo(ctx)
    const installToken = await fetchInstallToken(ctx.config, owner, name)
    const r = await runCommand(ctx, GIT_REBASE_SCRIPT, 'gitRebase', {}, {
      env: { OWNER: owner, REPO: name, INSTALL_TOKEN: installToken },
      toolUseId: ctx.toolUseId,
    })
    if (r.exitCode !== 0) return { ok: false, error: `rebase failed: ${r.stderr || r.stdout}`.slice(0, 500) }
    return { ok: true }
  } catch (errVal) {
    return { ok: false, error: errMsg(errVal) }
  }
}

// ── gitMerge ──

async function handleGitMerge(ctx: GithubCtx, args: z.infer<typeof gitMergeArgs>) {
  try {
    const prInputs = buildPrInputs(ctx, { ...args, draft: false })
    const r = await pushAndOpenPr(ctx, prInputs, 'gitMerge')
    return await processGitMerge(prInputs, r)
  } catch (errVal) {
    return { ok: false, error: errMsg(errVal) }
  }
}

async function processGitMerge(prInputs: PrInputs, r: { exitCode: number; stdout: string; stderr: string; installToken: string }) {
  if (r.exitCode === 64 || r.stdout.trim() === 'NOTHING_TO_PUBLISH') {
    return { ok: false, error: 'no commits to publish — call gitCommit first' }
  }
  if (r.exitCode !== 0) return { ok: false, error: 'push or PR create failed (see execution row for details)' }
  const lookup = await resolvePrAfterPush(prInputs, r)
  if (!lookup.ok) return { ok: false, error: lookup.error }
  return mergePr(prInputs, r.installToken, lookup)
}

async function resolvePrAfterPush(prInputs: PrInputs, r: { stdout: string; installToken: string }): Promise<{ ok: true; prUrl: string; prNumber: number } | { ok: false; error: string }> {
  const parsed = parsePrCreateResponse(r.stdout)
  if (parsed.ok && parsed.prNumber) return { ok: true, prUrl: parsed.prUrl, prNumber: parsed.prNumber }
  if (parsed.status === 422 && parsed.jsonBody.includes('already exists')) {
    return await lookupExistingPr(prInputs, r.installToken)
  }
  return { ok: false, error: parsed.ok ? 'PR response missing number' : parsed.error }
}

async function lookupExistingPr(prInputs: PrInputs, installToken: string): Promise<{ ok: true; prUrl: string; prNumber: number } | { ok: false; error: string }> {
  const url = `https://api.github.com/repos/${prInputs.owner}/${prInputs.name}/pulls?head=${encodeURIComponent(`${prInputs.owner}:${prInputs.branch}`)}&state=open`
  const lookupRes = await fetch(url, { headers: { Authorization: `Bearer ${installToken}`, Accept: 'application/vnd.github+json' } })
  if (!lookupRes.ok) return { ok: false, error: `PR lookup failed: ${lookupRes.status}` }
  const prs = await lookupRes.json() as Array<{ html_url: string; number: number }>
  if (!prs.length) return { ok: false, error: 'PR reported as existing but not found via API' }
  return { ok: true, prUrl: prs[0].html_url, prNumber: prs[0].number }
}

async function mergePr(prInputs: PrInputs, installToken: string, lookup: { prUrl: string; prNumber: number }) {
  const mergeRes = await fetch(
    `https://api.github.com/repos/${prInputs.owner}/${prInputs.name}/pulls/${lookup.prNumber}/merge`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${installToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'merge' }),
    },
  )
  if (!mergeRes.ok) {
    const mergeErr = await mergeRes.text().catch(() => '')
    return { ok: false, error: `merge failed (HTTP ${mergeRes.status}): ${mergeErr.slice(0, 300)}. PR is open at ${lookup.prUrl} — resolve conflicts and merge manually, or call gitRebase and retry.` }
  }
  return { ok: true, merged: true, branch: prInputs.branch, prUrl: lookup.prUrl }
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

export const tools: ToolDef<GithubCtx>[] = [
  { name: 'gitClone',       description: 'Clone the configured GitHub repo into the empty session workspace at /home/foundry. Creates the per-session branch `foundry/<session-id>` and switches to it. Typical first step of a code session — the workspace starts empty, nothing is pre-cloned. Optional owner/repo args override the project default if you need a different repo.', schema: gitCloneArgs, handler: handleGitClone },
  { name: 'gitStatus',      description: 'Show the working tree status in porcelain format. Requires a workspace populated by gitClone (or manually) — fails if /home/foundry is not a git repo.',                                                                                                                                                                                    schema: gitStatusArgs, handler: handleGitStatus },
  { name: 'gitDiff',        description: 'Show the diff. By default shows unstaged changes; set staged=true to see the staged diff. Optionally scope to specific paths. Requires a git workspace (see gitClone).',                                                                                                                                                             schema: gitDiffArgs, handler: handleGitDiff },
  { name: 'gitAdd',         description: 'Stage specific paths for commit. Only literal repo-relative paths are accepted — no -A, no wildcards, no glob expansion. Paths inside .git/, .foundry/, node_modules/, build outputs, and caches are rejected. Requires a git workspace (see gitClone).',                                                                             schema: gitAddArgs, handler: handleGitAdd },
  { name: 'gitRemove',      description: 'Remove paths from the working tree and index (git rm). Same validation as gitAdd — literal paths only, protected directories rejected. Requires a git workspace (see gitClone).',                                                                                                                                                    schema: gitRemoveArgs, handler: handleGitRemove },
  { name: 'gitCommit',      description: 'Commit the staged index with a message. Fails if nothing is staged. Session id and ticket id are appended to the commit trailer automatically. Requires a git workspace (see gitClone).',                                                                                                                                            schema: gitCommitArgs, handler: handleGitCommit },
  { name: 'gitPullRequest', description: 'Push the session branch and open a pull request against the clone\'s default branch. The PR is NOT merged — a human reviews and merges it. Use this when review is wanted before landing. Pass draft:true to mark as draft. Call after at least one gitCommit. Posts a "PR opened" comment on the ticket. Requires a git workspace (see gitClone).', schema: gitPullRequestArgs, handler: handleGitPullRequest },
  { name: 'gitMerge',       description: 'Push the session branch, open a PR, and merge it immediately to the default branch. This is the trunk-based tool — code lands on main in one call. Fails with an error if there\'s a merge conflict (the PR is left open for manual resolution or gitRebase). Call after at least one gitCommit. Posts a "Merged" comment on the ticket. Requires a git workspace (see gitClone).', schema: gitMergeArgs, handler: handleGitMerge },
  { name: 'gitRebase',      description: 'Fetch latest main from origin and rebase the session branch on top of it. Use this after gitMerge fails due to a merge conflict — rebase resolves the conflict by replaying your commits on the latest main, then retry gitMerge. If the rebase itself has conflicts that git cannot auto-resolve, this tool fails with the conflict details. Requires a git workspace (see gitClone).', schema: gitRebaseArgs, handler: handleGitRebase },
]
