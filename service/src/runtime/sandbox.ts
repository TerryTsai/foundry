import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import { join } from 'path'

import { toInt } from '../functional.js'

// Podman sandbox runner. Wraps the user command to capture cgroup +
// network stats on exit via a sentinel delimiter on stdout so we can
// parse them out without polluting user-visible output.

export interface RunOptions {
  command:    string
  workspace:  string
  statsDir:   string       // host-side tmpdir for stats file — mounted into the container
  image:      string
  env:        Record<string, string>
  network:    boolean
  mount:      'rw' | 'ro' | 'none'
  /** Isolated-workspace mode. When true, /work is not mounted; /input
   *  and /output (if provided) expose the artifact allowlist. Host-side
   *  copy-in/out is handled by the caller (domain.executionCreate). */
  isolated:   boolean
  inputDir:   string | null
  outputDir:  string | null
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

// Stats are written to a file (/foundry-stats/stats) instead of stdout.
// This completely separates cgroup metrics from user output — no delimiter
// parsing, no contamination, no stdout corruption for tools that produce
// large or unterminated output (curl -w, etc.).
const STATS_FILE = '/foundry-stats/stats'

function emptyStats(): ContainerStats {
  return { peakMemoryMb: null, cpuMs: null, netRxBytes: null, netTxBytes: null, exitSignal: null }
}

function escapeShellArg(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function wrapCommand(command: string): string {
  return [
    `sh -c ${escapeShellArg(command)}`,
    `__ec=$?`,
    // Write cgroup stats to a file — NOT stdout. The host reads it after
    // the container exits via the mounted statsDir.
    `{`,
    `  cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true`,
    `  echo "---"`,
    `  cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || echo 0`,
    `  echo "---"`,
    `  cat /proc/net/dev 2>/dev/null | tail -n+3 || true`,
    `} > ${STATS_FILE} 2>/dev/null`,
    `exit $__ec`,
  ].join('\n')
}

function podmanArgs(opts: RunOptions): string[] {
  const { workspace, statsDir, image, env, network, mount, isolated, inputDir, outputDir, memoryMb, cpus, pidsLimit, nofileSoft, nofileHard, tmpfsMb, command } = opts
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  // Isolated mode: /work is NOT mounted. /input (ro) and /output (rw)
  // expose the artifact allowlist. cwd defaults to /tmp (writable tmpfs)
  // so tools that scribble in their cwd don't hit EROFS.
  const workspaceArgs = isolated
    ? [
        ...(inputDir  ? ['-v', `${inputDir}:/input:ro`] : []),
        ...(outputDir ? ['-v', `${outputDir}:/output`]  : []),
        '-w', '/tmp',
      ]
    : mount === 'none'
      ? [] as string[]
      : ['-v', `${workspace}:/work${mount === 'ro' ? ':ro' : ''}`, '-w', '/work']
  return [
    'run', '--rm',
    ...(network ? [] : ['--network=none']),
    '--memory', `${memoryMb}m`, '--memory-swap', `${memoryMb}m`,
    '--cpus', String(cpus), '--pids-limit', String(pidsLimit),
    '--ulimit', `nofile=${nofileSoft}:${nofileHard}`,
    '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', `/tmp:rw,size=${tmpfsMb}m`, '--tmpfs', `/run:rw,size=8m`,
    '-v', `${statsDir}:/foundry-stats`,   // stats file written here, read by host after exit
    ...workspaceArgs,
    ...envArgs,
    image, 'sh', '-c', wrapCommand(command),
  ]
}

function parseNet(section: string): [number, number] | null {
  let rx = 0, tx = 0, hasNet = false
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('lo:')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 10) continue
    rx += toInt(parts[1])
    tx += toInt(parts[9])
    hasNet = true
  }
  return hasNet ? [rx, tx] : null
}

function parseStats(lines: string[], timedOut: boolean): ContainerStats {
  if (timedOut) return { ...emptyStats(), exitSignal: 'timeout' }
  const [cpu = '', mem = '', net = ''] = lines.join('\n').split('---')
  const cpuUsec  = toInt(cpu.match(/usage_usec\s+(\d+)/)?.[1] ?? '')
  const memBytes = toInt(mem.trim())
  const netBytes = parseNet(net)
  return {
    cpuMs:        cpuUsec  > 0 ? Math.round(cpuUsec / 1000) : null,
    peakMemoryMb: memBytes > 0 ? Math.round(memBytes / (1024 * 1024) * 100) / 100 : null,
    netRxBytes:   netBytes?.[0] ?? null,
    netTxBytes:   netBytes?.[1] ?? null,
    exitSignal:   null,
  }
}

function readStatsFile(statsDir: string): ContainerStats {
  try {
    const raw = readFileSync(join(statsDir, 'stats'), 'utf-8')
    const lines = raw.split('\n')
    return parseStats(lines, false)
  } catch {
    return emptyStats()
  }
}

export function spawnRun(opts: RunOptions): RunHandle {
  const child   = spawn('podman', podmanArgs(opts))
  const emitter = new EventEmitter()
  let stdoutRaw = ''
  let stderrRaw = ''
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
    emitter.emit('exit', -1, { ...emptyStats(), exitSignal: 'timeout' })
  }, opts.timeoutMs)

  child.stdout.on('data', (d: Buffer) => { stdoutRaw += d.toString() })
  child.stderr.on('data', (d: Buffer) => { stderrRaw += d.toString() })
  child.on('close', (code) => {
    clearTimeout(timeout)
    if (timedOut) return
    // Stdout is ONLY user output now — stats are in the file.
    const userOut = stdoutRaw.replace(/\n+$/, '')
    if (userOut) emitter.emit('stdout', userOut)
    if (stderrRaw) emitter.emit('stderr', stderrRaw.replace(/\n+$/, ''))
    const stats = readStatsFile(opts.statsDir)
    emitter.emit('exit', code ?? -1, stats)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}
