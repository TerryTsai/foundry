import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeRunCommandTool } from '../../tools/run_command.js'

const deps = {
  sandboxUrl: 'http://sandbox:3004',
  image: 'node:20',
  workspace: '/tmp/work',
  env: {},
  sessionId: 'sess1',
}

afterEach(() => vi.unstubAllGlobals())

describe('run_command tool', () => {
  it('returns stdout/stderr/exitCode on success', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // POST /sandbox → { id: 'run1' }
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'run1' }),
      })
      // GET /sandbox/run1/output — SSE stream with stdout + exit
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              'event: stdout\ndata: {"line":"hello"}\n\n',
              'event: exit\ndata: {"code":0}\n\n',
            ]
            let i = 0
            return {
              read: async () => {
                if (i < chunks.length) {
                  return { done: false, value: Buffer.from(chunks[i++]) }
                }
                return { done: true, value: undefined }
              },
              cancel: () => {},
            }
          },
        },
      })
    )

    const tool = makeRunCommandTool(deps)
    const result = JSON.parse(await tool.execute({ command: 'echo hello' })) as {
      stdout: string
      stderr: string
      exitCode: number
    }

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
  })

  it('returns error when sandbox start fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }))

    const tool = makeRunCommandTool(deps)
    const result = JSON.parse(await tool.execute({ command: 'fail' })) as { error: string }
    expect(result.error).toMatch(/failed to start sandbox/)
  })

  it('prepends cwd to command when provided', async () => {
    let capturedBody: { command?: string } = {}
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async (_url: string, opts: { body?: string }) => {
        capturedBody = JSON.parse(opts?.body ?? '{}') as { command: string }
        return { ok: true, json: async () => ({ id: 'r1' }) }
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => {
            const chunks = ['event: exit\ndata: {"code":0}\n\n']
            let i = 0
            return {
              read: async () => i < chunks.length
                ? { done: false, value: Buffer.from(chunks[i++]) }
                : { done: true, value: undefined },
              cancel: () => {},
            }
          },
        },
      })
    )

    const tool = makeRunCommandTool(deps)
    await tool.execute({ command: 'npm test', cwd: 'src' })
    expect(capturedBody.command).toBe('cd src && npm test')
  })
})
