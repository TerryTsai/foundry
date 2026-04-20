import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { toInt } from '../../../core/util.js'

// Persistent session container.
//
// Each agent session gets ONE long-lived podman container. Every tool
// call for that session execs into it. State — filesystem writes,
// background processes, chromium instances, installed packages,
// running dev servers — all persists across tool calls. Container is
// created lazily on first tool use (by ensureSessionContainer) and
// torn down when the session ends (see pipeline/bookkeeping.ts).
//
// Containers are named `foundry-sess-<sessionId>` so SIGTERM cleanup
// can find them.

const activeSessionContainers = new Map<string, string>()

export interface SessionContainerOpts {
  sessionId:   string
  workspace:   string
  image:       string
  memoryMb:    number
  cpus:        number
  pidsLimit:   number
  nofileSoft:  number
  nofileHard:  number
  tmpfsMb:     number
}

export interface ContainerStats {
  peakMemoryMb: number | null
  cpuMs:        number | null
  netRxBytes:   number | null
  netTxBytes:   number | null
  exitSignal:   string | null
}

export interface ExecHandle {
  emitter: EventEmitter
  kill:    () => void
}

function emptyStats(): ContainerStats {
  return { peakMemoryMb: null, cpuMs: null, netRxBytes: null, netTxBytes: null, exitSignal: null }
}

export async function ensureSessionContainer(opts: SessionContainerOpts): Promise<string> {
  const existing = activeSessionContainers.get(opts.sessionId)
  if (existing) return existing
  return startSessionContainer(opts)
}

export function startSessionContainer(opts: SessionContainerOpts): Promise<string> {
  const name = `foundry-sess-${opts.sessionId}`
  const args = [
    'run', '-d', '--rm', '--name', name,
    '--memory', `${opts.memoryMb}m`, '--memory-swap', `${opts.memoryMb}m`,
    '--cpus', String(opts.cpus), '--pids-limit', String(opts.pidsLimit),
    '--ulimit', `nofile=${opts.nofileSoft}:${opts.nofileHard}`,
    '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', `/tmp:rw,size=${opts.tmpfsMb}m`, '--tmpfs', `/run:rw,size=8m`,
    '-v', `${opts.workspace}:/work:rw`, '-w', '/work',
    opts.image,
    // PID 1 just idles. Tools bring their own processes (chromium,
    // dev servers, compilers, …) via podman exec.
    'sleep', 'infinity',
  ]
  return new Promise((resolve, reject) => {
    const child = spawn('podman', args)
    let err = ''
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('close', (code) => {
      if (code === 0) { activeSessionContainers.set(opts.sessionId, name); resolve(name) }
      else reject(new Error(`podman run failed (${code}): ${err.trim()}`))
    })
  })
}

export function stopSessionContainer(sessionId: string): Promise<void> {
  const name = activeSessionContainers.get(sessionId)
  if (!name) return Promise.resolve()
  activeSessionContainers.delete(sessionId)
  return new Promise(resolve => {
    const child = spawn('podman', ['rm', '-f', name])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

export function stopAllSessionContainers(): void {
  for (const name of activeSessionContainers.values()) {
    try { spawn('podman', ['rm', '-f', name], { stdio: 'ignore' }) } catch {}
  }
  activeSessionContainers.clear()
}

// ── Exec ─────────────────────────────────────────────────────────────
//
// The command is wrapped to emit a sentinel stats line on stderr right
// before exit. We read cgroup v2 cpu.stat and /proc/net/dev before and
// after the user command, subtract, and emit the deltas. Stdout stays
// untouched — it's purely the user command's output.
//
// Why delta, not podman stats: podman stats reports the container's
// cumulative totals, not per-exec. With shared cgroup, per-exec memory
// peak can't be cleanly attributed and is dropped. CPU and network are
// cumulative counters so deltas work cleanly.

const STATS_SENTINEL = '__FOUNDRY_STATS__'

function statsWrapper(command: string): string {
  return [
    'CPU_B=$(awk "/usage_usec/ {print \\$2; exit}" /sys/fs/cgroup/cpu.stat 2>/dev/null)',
    'NET_B=$(tail -n+3 /proc/net/dev 2>/dev/null | awk "\\$1 !~ /lo:/ {rx+=\\$2; tx+=\\$10} END {print rx\\"|\\"tx}")',
    `sh -c ${shellEscape(command)}`,
    '__EC=$?',
    'CPU_A=$(awk "/usage_usec/ {print \\$2; exit}" /sys/fs/cgroup/cpu.stat 2>/dev/null)',
    'NET_A=$(tail -n+3 /proc/net/dev 2>/dev/null | awk "\\$1 !~ /lo:/ {rx+=\\$2; tx+=\\$10} END {print rx\\"|\\"tx}")',
    `echo "${STATS_SENTINEL}|$CPU_B|$CPU_A|$NET_B|$NET_A" >&2`,
    'exit $__EC',
  ].join('\n')
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function parseStatsLine(line: string, timedOut: boolean): ContainerStats {
  if (timedOut) return { ...emptyStats(), exitSignal: 'timeout' }
  // Format: __FOUNDRY_STATS__|cpuBefore|cpuAfter|netRxBefore|netTxBefore|netRxAfter|netTxAfter
  // (NET_B and NET_A each carry rx|tx separated by '|')
  const parts = line.split('|')
  if (parts.length < 7 || parts[0] !== STATS_SENTINEL) return emptyStats()
  const [ , cpuB, cpuA, rxB, txB, rxA, txA ] = parts
  const cpuUsec = Math.max(0, toInt(cpuA) - toInt(cpuB))
  const rxDelta = Math.max(0, toInt(rxA) - toInt(rxB))
  const txDelta = Math.max(0, toInt(txA) - toInt(txB))
  return {
    peakMemoryMb: null,
    cpuMs:        cpuUsec > 0 ? Math.round(cpuUsec / 1000) : null,
    netRxBytes:   rxDelta,
    netTxBytes:   txDelta,
    exitSignal:   null,
  }
}

// Split stderr into the user's real stderr + the stats sentinel line.
function extractStats(raw: string, timedOut: boolean): { userStderr: string; stats: ContainerStats } {
  const idx = raw.lastIndexOf(STATS_SENTINEL)
  if (idx < 0) return { userStderr: raw, stats: emptyStats() }
  const before = raw.slice(0, idx).replace(/\n+$/, '')
  const line   = raw.slice(idx).split('\n')[0]
  return { userStderr: before, stats: parseStatsLine(line, timedOut) }
}

export interface ExecOptions {
  timeoutMs?: number
  env?:       Record<string, string>
}

export function execInContainer(
  containerName: string, command: string, opts: ExecOptions = {},
): ExecHandle {
  const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const timeoutMs = opts.timeoutMs ?? 120_000
  const child: ChildProcess = spawn('podman', [
    'exec', '-i', ...envArgs, containerName,
    'sh', '-c', statsWrapper(command),
  ])
  const emitter = new EventEmitter()
  let stdoutBuf = ''
  let stderrBuf = ''
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)

  child.stdout?.on('data', (d: Buffer) => {
    const s = d.toString()
    stdoutBuf += s
    emitter.emit('stdout', s)
  })
  child.stderr?.on('data', (d: Buffer) => {
    stderrBuf += d.toString()
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    const { userStderr, stats } = extractStats(stderrBuf, timedOut)
    if (userStderr) emitter.emit('stderr', userStderr)
    // Ensure the stdout tail lands too (test hooks rely on a final flush)
    if (stdoutBuf && !stdoutBuf.endsWith('\n')) { /* already flushed per-chunk */ }
    emitter.emit('exit', timedOut ? -1 : (code ?? -1), stats)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}
