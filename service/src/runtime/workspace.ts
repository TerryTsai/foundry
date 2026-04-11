import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Ticket } from '../schema.js'
import { require, succeeds } from '../functional.js'
import { repoCloneUrl, pullRequestCreate } from '../github.js'

const execFileAsync = promisify(execFile)

export interface PublishResult {
  branch: string
  prUrl:  string
}

// Per-session git work tree: clone the project's GitHub repo into a tmpdir
// using a freshly-minted installation token, let the agent mutate it, then
// push any changes back and destroy the dir. No bare repos on disk.

export async function workspaceEmpty(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundry-session-'))
}

function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo.trim())
  if (!m) throw new Error(`invalid repo "${repo}" — expected "owner/name"`)
  return { owner: m[1], name: m[2] }
}

export async function workspaceClone(db: Db, config: Config, projectId: string): Promise<string> {
  const proj = require(database.projectGet(db, projectId), `project ${projectId} not found`)
  if (!proj.repo) throw new Error(`project ${proj.name} has no repo configured`)
  const { owner, name } = parseRepo(proj.repo)

  const cloneUrl = await repoCloneUrl(config, owner, name)
  const workDir  = await workspaceEmpty()
  await execFileAsync('git', ['clone', cloneUrl, workDir])

  // Replace the remote URL so the embedded token doesn't sit in .git/config
  // any longer than necessary. We'll mint a fresh token at push time.
  await execFileAsync('git', ['-C', workDir, 'remote', 'set-url', 'origin', `https://github.com/${owner}/${name}.git`])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name',  'Foundry'])
  return workDir
}

// Publish agent changes: push to a per-session branch and open a draft PR.
// Never pushes to the default branch directly — a human flips the PR to Ready
// after reviewing the diff. Returns null if the session made no changes.
export async function workspacePublish(
  db: Db, config: Config, sessionId: string, ticket: Ticket, workDir: string,
): Promise<PublishResult | null> {
  // Capture the clone's default branch before we switch off it — that's the
  // PR base. Usually `main`, but we don't assume it.
  const { stdout: baseRaw } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const baseBranch = baseRaw.trim()

  const branch = `foundry/${sessionId}`
  await execFileAsync('git', ['-C', workDir, 'checkout', '-b', branch])

  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  // `git diff --cached --quiet` exits non-zero when there are staged changes
  const clean = await succeeds(() => execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet']))
  if (clean) return null

  const title = ticket.title.trim() || ticket.id
  const commitMessage = `agent: ${title}\n\nSession: ${sessionId}\nTicket:  ${ticket.id}\n`
  await execFileAsync('git', ['-C', workDir, 'commit', '-m', commitMessage])

  // Fresh installation token for the push — the one used at clone time may be
  // close to expiry by now, and we already discarded it from .git/config.
  const proj = require(database.projectGet(db, ticket.project_id), `project ${ticket.project_id} not found`)
  const { owner, name } = parseRepo(proj.repo)
  const pushUrl = await repoCloneUrl(config, owner, name)
  await execFileAsync('git', ['-C', workDir, 'push', pushUrl, `HEAD:refs/heads/${branch}`])

  const prUrl = await pullRequestCreate(config, owner, name, {
    title: `[${ticket.id}] ${title}`,
    head:  branch,
    base:  baseBranch,
    body:  pullRequestBody(sessionId, ticket),
    draft: true,
  })
  return { branch, prUrl }
}

function pullRequestBody(sessionId: string, ticket: Ticket): string {
  const body = ticket.body.trim()
  const excerpt = body.length > 800 ? `${body.slice(0, 800)}…` : body
  return `Opened automatically by Foundry session \`${sessionId}\` for ticket \`${ticket.id}\`.\n\n**Ticket:** ${ticket.title.trim() || '(no title)'}\n\n> ${excerpt.replace(/\n/g, '\n> ')}\n\nThis PR is a draft. Review the diff and mark it Ready when you're satisfied.`
}

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}
