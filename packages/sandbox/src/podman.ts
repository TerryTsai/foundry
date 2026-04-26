import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { toInt } from '@foundry/model'

import type {
  SandboxState, SessionContainerOpts, ContainerStats, ExecHandle,
  ExecOptions, ExecState,
} from './schema.js'

// Persistent session container.
//
// Each agent session gets ONE long-lived podman container. Every tool
// call for that session execs into it. State persists across tool calls.
// Containers are named `foundry-sess-<sessionId>`. The map of active
// containers is held in SandboxState, threaded in by the composition
// root — no module-level state in sandbox.

function emptyStats(): ContainerStats {
  return { peakMemoryMb: null, cpuMs: null, netRxBytes: null, netTxBytes: null, exitSignal: null }
}

export async function ensureSessionContainer(state: SandboxState, opts: SessionContainerOpts): Promise<string> {
  const existing = state.sessionContainers.get(opts.sessionId)
  if (existing) return existing
  return startSessionContainer(state, opts)
}

export function startSessionContainer(state: SandboxState, opts: SessionContainerOpts): Promise<string> {
  const name = `foundry-sess-${opts.sessionId}`
  const args = buildContainerArgs(name, opts)
  return new Promise((resolve, reject) => spawnContainer(state, name, args, opts.sessionId, resolve, reject))
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
  state: SandboxState, name: string, args: string[], sessionId: string,
  resolve: (name: string) => void, reject: (e: Error) => void,
): void {
  const child = spawn('podman', args)
  let errBuf = ''
  child.stderr.on('data', (d: Buffer) => { errBuf += d.toString() })
  child.on('close', (code) => {
    if (code === 0) { state.sessionContainers.set(sessionId, name); resolve(name) }
    else reject(new Error(`podman run failed (${code}): ${errBuf.trim()}`))
  })
}

export function stopSessionContainer(state: SandboxState, sessionId: string): Promise<void> {
  const name = state.sessionContainers.get(sessionId)
  if (!name) return Promise.resolve()
  state.sessionContainers.delete(sessionId)
  return new Promise(resolve => {
    const child = spawn('podman', ['rm', '-f', name])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

export function stopAllSessionContainers(state: SandboxState): void {
  for (const name of state.sessionContainers.values()) {
    try { spawn('podman', ['rm', '-f', name], { stdio: 'ignore' }) } catch { /* best-effort */ }
  }
  state.sessionContainers.clear()
}

// ── Exec ─────────────────────────────────────────────────────────────
//
// Wrap commands to emit a sentinel stats line before exit. We read cgroup
// v2 cpu.stat and /proc/net/dev before/after, subtract, emit deltas. The
// sentinel string is inlined at every read site (per the
// repetition-over-abstraction principle: identical literals beat a named
// const that breaks the no-module-vars rule).

function statsWrapper(command: string): string {
  return [
    'CPU_B=$(awk "/usage_usec/ {print \\$2; exit}" /sys/fs/cgroup/cpu.stat 2>/dev/null)',
    'NET_B=$(tail -n+3 /proc/net/dev 2>/dev/null | awk "\\$1 !~ /lo:/ {rx+=\\$2; tx+=\\$10} END {print rx\\"|\\"tx}")',
    `sh -c ${shellEscape(command)}`,
    '__EC=$?',
    'CPU_A=$(awk "/usage_usec/ {print \\$2; exit}" /sys/fs/cgroup/cpu.stat 2>/dev/null)',
    'NET_A=$(tail -n+3 /proc/net/dev 2>/dev/null | awk "\\$1 !~ /lo:/ {rx+=\\$2; tx+=\\$10} END {print rx\\"|\\"tx}")',
    'echo "__FOUNDRY_STATS__|$CPU_B|$CPU_A|$NET_B|$NET_A" >&2',
    'exit $__EC',
  ].join('\n')
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function parseStatsLine(line: string, timedOut: boolean): ContainerStats {
  if (timedOut) return { ...emptyStats(), exitSignal: 'timeout' }
  const parts = line.split('|')
  if (parts.length < 7 || parts[0] !== '__FOUNDRY_STATS__') return emptyStats()
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
  const idx = raw.lastIndexOf('__FOUNDRY_STATS__')
  if (idx < 0) return { userStderr: raw, stats: emptyStats() }
  const before = raw.slice(0, idx).replace(/\n+$/, '')
  const line   = raw.slice(idx).split('\n')[0]
  return { userStderr: before, stats: parseStatsLine(line, timedOut) }
}

export function execInContainer(
  containerName: string, command: string, opts: ExecOptions = {},
): ExecHandle {
  const child = spawnExec(containerName, command, opts)
  const emitter = new EventEmitter()
  const state: ExecState = { stdoutBuf: '', stderrBuf: '', timedOut: false }
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
  state: ExecState, timer: NodeJS.Timeout,
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
  state: ExecState, code: number | null,
): void {
  clearTimeout(timer)
  const { userStderr, stats } = extractStats(state.stderrBuf, state.timedOut)
  if (userStderr) emitter.emit('stderr', userStderr)
  emitter.emit('exit', state.timedOut ? -1 : (code ?? -1), stats)
}
