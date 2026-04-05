import { execFile } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const exec = promisify(execFile)

export async function createTempRepo(): Promise<{ repoBase: string; slug: string; cleanup: () => Promise<void> }> {
  // Create a temp base dir and a bare repo inside it
  const repoBase = await mkdtemp(join(tmpdir(), 'foundry-test-'))
  const slug = 'test-project'
  const bareRepo = join(repoBase, `${slug}.git`)

  // Init bare repo
  await exec('git', ['init', '--bare', bareRepo])

  // Create a working clone, add an initial commit, push back
  const workDir = await mkdtemp(join(tmpdir(), 'foundry-work-'))
  try {
    await exec('git', ['clone', bareRepo, workDir])
    await exec('git', ['-C', workDir, 'config', 'user.email', 'test@test.com'])
    await exec('git', ['-C', workDir, 'config', 'user.name', 'Test'])

    const { writeFile, mkdir } = await import('fs/promises')
    await writeFile(join(workDir, 'AGENT.md'), '# Agent\n\nStack: Node.js\n', 'utf8')
    await mkdir(join(workDir, 'src'), { recursive: true })
    await writeFile(join(workDir, 'src', 'index.ts'), 'console.log("hello")\n', 'utf8')

    await exec('git', ['-C', workDir, 'add', '.'])
    await exec('git', ['-C', workDir, 'commit', '-m', 'initial commit'])
    // Determine the local branch name, then push and update bare repo HEAD
    const { stdout: branchOut } = await exec('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = branchOut.trim()
    await exec('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch}`])
    // Ensure bare repo HEAD resolves correctly
    await exec('git', ['-C', bareRepo, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

  return {
    repoBase,
    slug,
    cleanup: () => rm(repoBase, { recursive: true, force: true }),
  }
}
