import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import { require, slugify, succeeds } from '../functional.js'

const execFileAsync = promisify(execFile)

// Per-session git work tree: clone the project's bare repo into a tmpdir,
// let the agent mutate it, then push any changes back and destroy the dir.

export async function workspaceEmpty(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundry-session-'))
}

export async function workspaceClone(db: Db, config: Config, projectId: string): Promise<string> {
  const proj = require(database.projectGet(db, projectId), `project ${projectId} not found`)
  const workDir = await workspaceEmpty()
  const bare    = join(config.repoBase, `${slugify(proj.name)}.git`)
  await execFileAsync('git', ['clone', bare, workDir])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name',  'Foundry'])
  return workDir
}

export async function workspacePublish(workDir: string): Promise<void> {
  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  // `git diff --cached --quiet` exits non-zero when there are staged changes
  const clean = await succeeds(() => execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet']))
  if (clean) return
  await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
  const { stdout: branch } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch.trim()}`])
}

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}
