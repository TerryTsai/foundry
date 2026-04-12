import { spawn } from 'child_process'
import { EventEmitter } from 'events'

import { toInt } from '../functional.js'

// Podman sandbox runner. Wraps the user command to capture cgroup +
// network stats on exit via a sentinel delimiter on stdout so we can
// parse them out without polluting user-visible output.

export interface RunOptions {
  command:    string
  workspace:  string
  image:      string
  env:        Record<string, string>
  network:    boolean
  mount:      'rw' | 'ro' | 'none'
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

const STATS_DELIM = '___FOUNDRY_STATS___'

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
    `echo ""`,              // guarantee a newline after user output so the
    `echo "${STATS_DELIM}"`,// delimiter always starts on its own line
    `cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true`,
    `echo "---"`,
    `cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || echo 0`,
    `echo "---"`,
    `cat /proc/net/dev 2>/dev/null | tail -n+3 || true`,
    `exit $__ec`,
  ].join('\n')
}

function podmanArgs(opts: RunOptions): string[] {
  const { workspace, image, env, network, mount, memoryMb, cpus, pidsLimit, nofileSoft, nofileHard, tmpfsMb, command } = opts
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  // Mount modes:
  //   'rw'   → bind-mount workspace to /work, read-write (tier-1 default)
  //   'ro'   → bind-mount workspace to /work, read-only (tier-2 for tools
  //            that need to read workspace state but must not mutate it —
  //            e.g., secret-using tools reading .git state to push)
  //   'none' → no workspace mount at all (tier-2 for pure-API tools like
  //            Slack/Notion; nothing from /work is visible to the container)
  const mountArgs = mount === 'none'
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
    ...mountArgs,
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

function finalize(stdoutRaw: string, emitter: EventEmitter, code: number): void {
  // Split the accumulated raw stdout by newlines ONCE at the end, then
  // locate the stats sentinel. Splitting per-chunk in the data handler
  // was buggy: chunk boundaries mid-line injected fake newlines into
  // payloads (broke long JSON responses from curl, for example).
  const allLines = stdoutRaw.split('\n')
  const delimIdx = allLines.indexOf(STATS_DELIM)
  const userLines  = delimIdx >= 0 ? allLines.slice(0, delimIdx) : allLines
  const statsLines = delimIdx >= 0 ? allLines.slice(delimIdx + 1) : []
  // Emit as one join — the consumer will re-join with '\n' anyway, so
  // preserving the original boundaries (or lack thereof) matters more
  // than emitting one event per line.
  const userOut = userLines.join('\n').replace(/\n+$/, '')
  if (userOut) emitter.emit('stdout', userOut)
  emitter.emit('exit', code, parseStats(statsLines, false))
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

  // Accumulate raw bytes rather than splitting per-chunk. Chunk boundaries
  // don't align with line boundaries — splitting on each data event would
  // inject fake newlines at buffer cutoffs.
  child.stdout.on('data', (d: Buffer) => { stdoutRaw += d.toString() })
  child.stderr.on('data', (d: Buffer) => { stderrRaw += d.toString() })
  child.on('close', (code) => {
    clearTimeout(timeout)
    if (timedOut) return
    if (stderrRaw) emitter.emit('stderr', stderrRaw.replace(/\n+$/, ''))
    finalize(stdoutRaw, emitter, code ?? -1)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}
