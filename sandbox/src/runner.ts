import { spawn } from 'child_process'
import { EventEmitter } from 'events'

export interface RunOptions {
  image: string
  command: string
  workspace: string
  env: Record<string, string>
  network: boolean
  timeoutMs: number
}

export interface RunHandle {
  emitter: EventEmitter
  kill: () => void
}

export function spawnRun(opts: RunOptions): RunHandle {
  const { image, command, workspace, env, network, timeoutMs } = opts

  const args = [
    'run', '--rm',
    network ? '' : '--network=none',
    '-v', `${workspace}:/work`,
    '-w', '/work',
  ].filter(Boolean)

  for (const [key, val] of Object.entries(env)) {
    args.push('-e', `${key}=${val}`)
  }

  args.push(image, 'sh', '-c', command)

  const child = spawn('podman', args)
  const emitter = new EventEmitter()

  const timeout = setTimeout(() => {
    child.kill('SIGKILL')
    emitter.emit('exit', -1)
  }, timeoutMs)

  child.stdout.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) emitter.emit('stdout', line)
    }
  })

  child.stderr.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) emitter.emit('stderr', line)
    }
  })

  child.on('close', (code: number | null) => {
    clearTimeout(timeout)
    emitter.emit('exit', code ?? -1)
  })

  return {
    emitter,
    kill: () => child.kill('SIGKILL'),
  }
}
