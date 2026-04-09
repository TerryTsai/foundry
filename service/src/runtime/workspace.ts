import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Config } from '../config.js'
import { slugify } from '../functional.js'

const execFileAsync = promisify(execFile)

// Per-session working tree: clone the project's bare repo into a tmpdir,
// let the agent mutate it, then push any changes back and destroy the dir.

const empty = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'foundry-session-'))

const clone = (db: Db, config: Config) => async (projectId: string): Promise<string> => {
  const proj = database.project.get(db, projectId)
  if (!proj) throw new Error(`project ${projectId} not found`)
  const slug = slugify(proj.name)
  const workDir = await empty()
  const bare = join(config.repoBase, `${slug}.git`)
  await execFileAsync('git', ['clone', bare, workDir])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Foundry'])
  return workDir
}

const publish = async (workDir: string): Promise<void> => {
  // Stage and commit any changes the agent made
  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  try {
    await execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet'])
    // No changes to commit
  } catch {
    // There are staged changes — commit and push
    await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
    const { stdout: branch } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch.trim()}`])
  }
}

const destroy = async (workDir: string): Promise<void> => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export const workspace = { clone, empty, publish, destroy }
export default workspace
