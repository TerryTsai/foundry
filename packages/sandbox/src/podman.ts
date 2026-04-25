import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { toInt } from '@foundry/model'

// Persistent session container.
//
// Each agent session gets ONE long-lived podman container. Every tool
// call for that session execs into it. State persists across tool calls.
// Containers are named `foundry-sess-<sessionId>`.

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
  const args = buildContainerArgs(name, opts)
  return new Promise((resolve, reject) => spawnContainer(name, args, opts.sessionId, resolve, reject))
}

function buildContainerArgs(name: string, opts: SessionContainerOpts): string[] {
  return [
    'run', '-d', '--rm', '--name', name,
    '--memory', `${opts.memoryMb}m`, '--memory-swap', `${opts.memoryMb}m`,
    '--cpus', String(opts.cpus), '--pids-limit', String(opts.pidsLimit),
    '--ulimit', `nofile=${opts.nofileSoft}:${opts.nofileHard}`,
    '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', `/tmp:rw,size=${opts.tmpfsMb}m`, '--tmpfs', `/run:rw,size=8m`,
    '-v', `${opts.workspace}:/home/foundry:rw`, '-w', '/home/foundry',
    opts.image,
    'sleep', 'infinity',
  ]
}

function spawnContainer(
  name: string, args: string[], sessionId: string,
  resolve: (name: string) => void, reject: (e: Error) => void,
): void {
  const child = spawn('podman', args)
  let errBuf = ''
  child.stderr.on('data', (d: Buffer) => { errBuf += d.toString() })
  child.on('close', (code) => {
    if (code === 0) { activeSessionContainers.set(sessionId, name); resolve(name) }
    else reject(new Error(`podman run failed (${code}): ${errBuf.trim()}`))
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
    try { spawn('podman', ['rm', '-f', name], { stdio: 'ignore' }) } catch { /* best-effort */ }
  }
  activeSessionContainers.clear()
}

// ── Exec ─────────────────────────────────────────────────────────────
//
// Wrap commands to emit a sentinel stats line before exit. We read cgroup
// v2 cpu.stat and /proc/net/dev before/after, subtract, emit deltas.

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
  const parts = line.split('|')
  if (parts.length < 7 || parts[0] !== STATS_SENTINEL) return emptyStats()
  return statsFromParts(parts)
}

function statsFromParts(parts: string[]): ContainerStats {
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
  const child = spawnExec(containerName, command, opts)
  const emitter = new EventEmitter()
  const state = { stdoutBuf: '', stderrBuf: '', timedOut: false }
  const timer = setTimeout(() => { state.timedOut = true; child.kill('SIGKILL') }, opts.timeoutMs ?? 120_000)
  wireExecStreams(child, emitter, state, timer)
  return { emitter, kill: () => child.kill('SIGKILL') }
}

function spawnExec(containerName: string, command: string, opts: ExecOptions): ChildProcess {
  const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return spawn('podman', [
    'exec', '-i', ...envArgs, containerName,
    'sh', '-c', statsWrapper(command),
  ])
}

function wireExecStreams(
  child: ChildProcess, emitter: EventEmitter,
  state: { stdoutBuf: string; stderrBuf: string; timedOut: boolean },
  timer: NodeJS.Timeout,
): void {
  child.stdout?.on('data', (d: Buffer) => {
    const s = d.toString()
    state.stdoutBuf += s
    emitter.emit('stdout', s)
  })
  child.stderr?.on('data', (d: Buffer) => { state.stderrBuf += d.toString() })
  child.on('close', (code) => emitExecExit(emitter, timer, state, code))
}

function emitExecExit(
  emitter: EventEmitter, timer: NodeJS.Timeout,
  state: { stderrBuf: string; timedOut: boolean }, code: number | null,
): void {
  clearTimeout(timer)
  const { userStderr, stats } = extractStats(state.stderrBuf, state.timedOut)
  if (userStderr) emitter.emit('stderr', userStderr)
  emitter.emit('exit', state.timedOut ? -1 : (code ?? -1), stats)
}
