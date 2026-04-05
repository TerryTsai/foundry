import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function gitExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

export async function listFiles(repoPath: string): Promise<string[]> {
  const out = await gitExec(['ls-tree', '-r', 'HEAD', '--name-only'], repoPath)
  return out.trim() ? out.trim().split('\n') : []
}

export async function readFile(repoPath: string, filePath: string): Promise<string> {
  return gitExec(['show', `HEAD:${filePath}`], repoPath)
}

export async function writeFile(repoPath: string, filePath: string, content: string, message: string): Promise<void> {
  // Clone into a temp work tree, write the file, commit, push back
  const { execFile: ef } = await import('child_process')
  const exec = promisify(ef)

  const { mkdtemp, rm, writeFile: fsWrite, mkdir } = await import('fs/promises')
  const { join, dirname } = await import('path')
  const { tmpdir } = await import('os')

  const workDir = await mkdtemp(join(tmpdir(), 'foundry-repo-'))
  try {
    await exec('git', ['clone', repoPath, workDir])
    await exec('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
    await exec('git', ['-C', workDir, 'config', 'user.name', 'Foundry'])
    const target = join(workDir, filePath)
    await mkdir(dirname(target), { recursive: true })
    await fsWrite(target, content, 'utf8')
    await exec('git', ['-C', workDir, 'add', filePath])
    await exec('git', ['-C', workDir, 'commit', '-m', message, '--allow-empty'])
    const { stdout: branchOut } = await exec('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = branchOut.trim()
    await exec('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch}`])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
