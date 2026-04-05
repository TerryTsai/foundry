import { z } from 'zod'

export interface RunCommandDeps {
  sandboxUrl: string
  image: string
  workspace: string
  env: Record<string, string>
  sessionId: string
}

const params = z.object({
  command: z.string().describe('Shell command to run'),
  cwd: z.string().optional().describe('Working directory relative to /work (default: /work)'),
  network: z.boolean().optional().describe('Enable network access (default: false)'),
})

async function consumeSse(url: string): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`SSE request failed: ${res.status}`)

  const stdout: string[] = []
  const stderr: string[] = []
  let exitCode = -1

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const events = buf.split('\n\n')
    buf = events.pop() ?? ''

    for (const event of events) {
      const lines = event.split('\n')
      let eventType = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7)
        if (line.startsWith('data: ')) data = line.slice(6)
      }
      if (!eventType || !data) continue
      try {
        const parsed = JSON.parse(data) as { line?: string; code?: number }
        if (eventType === 'stdout' && parsed.line) stdout.push(parsed.line)
        if (eventType === 'stderr' && parsed.line) stderr.push(parsed.line)
        if (eventType === 'exit') {
          exitCode = parsed.code ?? -1
          reader.cancel()
          return { stdout, stderr, exitCode }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return { stdout, stderr, exitCode }
}

export function makeRunCommandTool(deps: RunCommandDeps) {
  return {
    name: 'run_command' as const,
    description: 'Run a shell command in a sandboxed Podman container. Returns stdout, stderr, and exit code.',
    params,
    async execute(rawArgs: unknown): Promise<string> {
      const args = params.parse(rawArgs)
      const command = args.cwd ? `cd ${args.cwd} && ${args.command}` : args.command

      const startRes = await fetch(`${deps.sandboxUrl}/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: deps.image,
          command,
          workspace: deps.workspace,
          env: deps.env,
          session_id: deps.sessionId,
          network: args.network ?? false,
        }),
      })

      if (!startRes.ok) {
        return JSON.stringify({ error: `failed to start sandbox: ${startRes.status}` })
      }

      const { id: runId } = await startRes.json() as { id: string }

      try {
        const result = await consumeSse(`${deps.sandboxUrl}/sandbox/${runId}/output`)
        return JSON.stringify({
          stdout: result.stdout.join('\n'),
          stderr: result.stderr.join('\n'),
          exitCode: result.exitCode,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return JSON.stringify({ error: msg })
      }
    },
  }
}

export type RunCommandTool = ReturnType<typeof makeRunCommandTool>
