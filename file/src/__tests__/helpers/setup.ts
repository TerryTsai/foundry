import { execFile } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const exec = promisify(execFile)

export async function createTestProject(): Promise<{ basePath: string; slug: string; cleanup: () => Promise<void> }> {
  const basePath = await mkdtemp(join(tmpdir(), 'foundry-test-'))
  const slug = 'test-project'
  const bareDir = join(basePath, `${slug}.git`)

  await exec('git', ['init', '--bare', bareDir])

  const workDir = await mkdtemp(join(tmpdir(), 'foundry-work-'))
  try {
    await exec('git', ['clone', bareDir, workDir])
    await exec('git', ['-C', workDir, 'config', 'user.email', 'test@test.com'])
    await exec('git', ['-C', workDir, 'config', 'user.name', 'Test'])

    const { writeFile, mkdir } = await import('fs/promises')
    await writeFile(join(workDir, 'AGENT.md'), '# Agent\n\nStack: Node.js\n', 'utf8')
    await mkdir(join(workDir, 'src'), { recursive: true })
    await writeFile(join(workDir, 'src', 'index.ts'), 'console.log("hello")\n', 'utf8')

    await exec('git', ['-C', workDir, 'add', '.'])
    await exec('git', ['-C', workDir, 'commit', '-m', 'initial commit'])
    const { stdout: branchOut } = await exec('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = branchOut.trim()
    await exec('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch}`])
    await exec('git', ['-C', bareDir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

  return {
    basePath,
    slug,
    cleanup: () => rm(basePath, { recursive: true, force: true }),
  }
}
