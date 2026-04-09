import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'

const execFileAsync = promisify(execFile)

export interface RunOptions {
  command:    string
  workspace:  string
  image:      string
  env:        Record<string, string>
  network:    boolean
  timeoutMs:  number
  memoryMb:   number
  cpus:       number
  pidsLimit:  number
  nofileSoft: number
  nofileHard: number
  tmpfsMb:    number
}

export interface ContainerStats {
  peakMemoryMb: number | null
  cpuMs:        number | null
  netRxBytes:   number | null
  netTxBytes:   number | null
  exitSignal:   string | null
}

export interface RunHandle {
  emitter: EventEmitter
  kill:    () => void
}

// Delimiter unlikely to appear in user output
const STATS_DELIM = '___FOUNDRY_STATS___'

// Wrap the user command to capture cgroup/network stats after it exits.
// The stats are printed to stdout after a known delimiter so we can
// parse them out without polluting the user-visible output.
function wrapCommand(command: string): string {
  return [
    `sh -c ${escapeShellArg(command)}`,
    `__ec=$?`,
    `echo "${STATS_DELIM}"`,
    `cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true`,
    `echo "---"`,
    `cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || echo 0`,
    `echo "---"`,
    `cat /proc/net/dev 2>/dev/null | tail -n+3 || true`,
    `exit $__ec`,
  ].join('\n')
}

function escapeShellArg(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export const spawnRun = (opts: RunOptions): RunHandle => {
  const { command, workspace, image, env, network, timeoutMs, memoryMb, cpus, pidsLimit, nofileSoft, nofileHard, tmpfsMb } = opts

  const args: string[] = [
    'run', '--rm',
    // Network: none unless explicitly enabled
    ...(network ? [] : ['--network=none']),
    // Memory: hard cap, no swap (so OOM kills, not slowly thrash)
    '--memory', `${memoryMb}m`,
    '--memory-swap', `${memoryMb}m`,
    // CPU: cap to N cores (fractional ok)
    '--cpus', String(cpus),
    // PIDs: stop fork bombs
    '--pids-limit', String(pidsLimit),
    // FDs: stop FD-leak DoS
    '--ulimit', `nofile=${nofileSoft}:${nofileHard}`,
    // Capabilities: drop everything; rootless Podman doesn't need any
    '--cap-drop', 'ALL',
    // Read-only root filesystem; only /work and /tmp tmpfs are writable
    '--read-only',
    '--tmpfs', `/tmp:rw,size=${tmpfsMb}m`,
    '--tmpfs', `/run:rw,size=8m`,
    '-v', `${workspace}:/work`,
    '-w', '/work',
  ]

  for (const [key, val] of Object.entries(env)) {
    args.push('-e', `${key}=${val}`)
  }

  args.push(image, 'sh', '-c', wrapCommand(command))

  const child = spawn('podman', args)
  const emitter = new EventEmitter()
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
    emitter.emit('exit', -1, { peakMemoryMb: null, cpuMs: null, netRxBytes: null, netTxBytes: null, exitSignal: 'timeout' } as ContainerStats)
  }, timeoutMs)

  const allStdout: string[] = []

  child.stdout.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) allStdout.push(line)
    }
  })

  child.stderr.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) emitter.emit('stderr', line)
    }
  })

  child.on('close', (code: number | null) => {
    clearTimeout(timeout)
    if (timedOut) return // already emitted

    // Split stdout into user output and stats
    const delimIdx = allStdout.indexOf(STATS_DELIM)
    const userLines = delimIdx >= 0 ? allStdout.slice(0, delimIdx) : allStdout
    const statsLines = delimIdx >= 0 ? allStdout.slice(delimIdx + 1) : []

    // Emit user stdout lines
    for (const line of userLines) emitter.emit('stdout', line)

    const stats = parseStats(statsLines, timedOut)
    emitter.emit('exit', code ?? -1, stats)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}

function parseStats(lines: string[], timedOut: boolean): ContainerStats {
  const stats: ContainerStats = { peakMemoryMb: null, cpuMs: null, netRxBytes: null, netTxBytes: null, exitSignal: null }
  if (timedOut) { stats.exitSignal = 'timeout'; return stats }

  const raw = lines.join('\n')
  const sections = raw.split('---')

  // Section 0: cpu.stat
  const cpuSection = sections[0] ?? ''
  const usageMatch = cpuSection.match(/usage_usec\s+(\d+)/)
  if (usageMatch) {
    stats.cpuMs = Math.round(parseInt(usageMatch[1], 10) / 1000)
  }

  // Section 1: memory.peak (bytes)
  const memSection = (sections[1] ?? '').trim()
  const memBytes = parseInt(memSection, 10)
  if (!isNaN(memBytes) && memBytes > 0) {
    stats.peakMemoryMb = Math.round((memBytes / (1024 * 1024)) * 100) / 100
  }

  // Section 2: /proc/net/dev
  const netSection = sections[2] ?? ''
  let rxTotal = 0, txTotal = 0, hasNet = false
  for (const line of netSection.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('lo:')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 10) {
      rxTotal += parseInt(parts[1], 10) || 0
      txTotal += parseInt(parts[9], 10) || 0
      hasNet = true
    }
  }
  if (hasNet) {
    stats.netRxBytes = rxTotal
    stats.netTxBytes = txTotal
  }

  return stats
}
