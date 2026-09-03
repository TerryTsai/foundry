import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import type { Config } from './config.js'
import type { Project, Task } from './schema.js'

export type SandboxResult = { output: string }

export async function runIsolatedWorker(config: Config, token: string, project: Project, task: Task): Promise<SandboxResult> {
  const runtime = project.config.runtime.type
  if (runtime !== 'podman' && runtime !== 'docker') throw new Error(`Unsupported isolated runtime: ${runtime}`)
  const image = project.config.runtime.image || config.sandboxImage
  const name = `foundry-${randomBytes(6).toString('hex')}`
  const prompt = workerPrompt(task)
  const command = harnessCommand(project)
  const environment = {
    ...process.env,
    FOUNDRY_REPO: project.id,
    FOUNDRY_BRANCH: project.defaultBranch,
    FOUNDRY_TASK_PATH: task.path,
    FOUNDRY_TASK_TITLE: task.title,
    FOUNDRY_PROMPT: prompt,
    FOUNDRY_HARNESS_COMMAND: command,
    FOUNDRY_VERIFY_COMMAND: project.config.verify || '',
    GITHUB_TOKEN: token,
    OPENAI_API_KEY: config.openaiApiKey,
    HOME: '/home/foundry',
    CODEX_HOME: '/home/foundry/.codex',
  }
  const args = [
    'run', '--rm', '--name', name,
    '--memory', '4g', '--cpus', '4', '--pids-limit', '1024', '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', '/tmp:rw,size=512m,mode=1777', '--tmpfs', '/workspace:rw,size=4096m,mode=1777', '--tmpfs', '/home/foundry:rw,size=256m,mode=1777',
    ...['FOUNDRY_REPO', 'FOUNDRY_BRANCH', 'FOUNDRY_TASK_PATH', 'FOUNDRY_TASK_TITLE', 'FOUNDRY_PROMPT', 'FOUNDRY_HARNESS_COMMAND', 'FOUNDRY_VERIFY_COMMAND', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'HOME', 'CODEX_HOME'].flatMap(key => ['-e', key]),
    image, 'sh', '-lc', sandboxScript(),
  ]
  return runProcess(runtime, args, name, config.sandboxTimeoutMs, environment)
}

function harnessCommand(project: Project): string {
  if (project.config.harness.command) return project.config.harness.command
  if (project.config.harness.type === 'codex') {
    return `printf '%s' "$FOUNDRY_PROMPT" | codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox -C /workspace -`
  }
  throw new Error(`Harness ${project.config.harness.type} requires an explicit command in .foundry/config.yaml`)
}

function sandboxScript(): string {
  return [
    'set -eu',
    'mkdir -p "$CODEX_HOME"',
    'AUTH=$(printf "x-access-token:%s" "$GITHUB_TOKEN" | base64 | tr -d "\\n")',
    'git -c http.extraHeader="Authorization: Basic $AUTH" clone --branch "$FOUNDRY_BRANCH" --single-branch "https://github.com/$FOUNDRY_REPO.git" /workspace',
    'cd /workspace',
    'BEFORE=$(git rev-parse HEAD)',
    'git config user.name "Foundry Worker"',
    'git config user.email "foundry-worker@users.noreply.github.com"',
    'sh -lc "$FOUNDRY_HARNESS_COMMAND"',
    'test -f "$FOUNDRY_TASK_PATH"',
    `grep -Eq "^status: ['\\\"]?(queued|working|needs_you|paused|done)['\\\"]?[[:space:]]*$" "$FOUNDRY_TASK_PATH"`,
    'git diff --check',
    'if [ -n "$FOUNDRY_VERIFY_COMMAND" ]; then sh -lc "$FOUNDRY_VERIFY_COMMAND"; fi',
    'git add -A',
    'if ! git diff --cached --quiet; then git commit -m "Foundry: advance $FOUNDRY_TASK_TITLE"; fi',
    'AFTER=$(git rev-parse HEAD)',
    'if [ "$BEFORE" = "$AFTER" ]; then echo "No durable checkpoint was produced" >&2; exit 42; fi',
    'git -c http.extraHeader="Authorization: Basic $AUTH" push origin "$FOUNDRY_BRANCH"',
  ].join('\n')
}

function workerPrompt(task: Task): string {
  return `Advance the Foundry task in ${task.path}: "${task.title}" as much as reasonably possible.

Make routine reversible decisions yourself. Inspect the repository, ${task.path}, and native harness instructions. Implement or research what the responsibility requires and verify your work. Do not create Foundry subtasks, runs, sessions, or journal entries.

Before exiting, rewrite ${task.path} into a compact current briefing. Preserve its frontmatter and use exactly one status: working when more autonomous progress remains, done when the responsibility is satisfied, or needs_you only when meaningful human judgment or action is genuinely required. Keep Current and Next concise and current; Git history is the journal. For needs_you, include the boundary and a recommendation. For a temporary delay, keep working and set next_eligible_at.

You are running inside a disposable isolated computer. Everything not committed and pushed will be lost. Foundry will verify and push the checkpoint after you exit.`
}

function runProcess(runtime: string, args: string[], name: string, timeoutMs: number, environment: NodeJS.ProcessEnv): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, args, { env: environment })
    let output = ''
    const append = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-40_000) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      spawn(runtime, ['rm', '-f', name], { stdio: 'ignore' })
    }, timeoutMs)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ output })
      else reject(new Error(`Isolated worker exited ${code}: ${output.slice(-4000)}`))
    })
  })
}
