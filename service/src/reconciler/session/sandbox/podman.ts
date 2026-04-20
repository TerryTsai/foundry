import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import { join } from 'path'

import { toInt } from '../../../core/util.js'

// Podman sandbox runner. Wraps the user command to capture cgroup +
// network stats on exit via a sentinel delimiter on stdout so we can
// parse them out without polluting user-visible output.

export interface RunOptions {
  command:    string
  workspace:  string
  statsDir:   string       // host-side tmpdir for stats file — mounted into the container
  /** Host-side dir staged with secret files (e.g. per-session sandbox
   *  token). Mounted read-only at /foundry-secrets in the container so
   *  the values don't appear in /proc/self/environ. */
  secretsDir: string | null
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
  const { workspace, statsDir, secretsDir, image, env, network, mount, isolated, inputDir, outputDir, memoryMb, cpus, pidsLimit, nofileSoft, nofileHard, tmpfsMb, command } = opts
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
    ...(secretsDir ? ['-v', `${secretsDir}:/foundry-secrets:ro`] : []),
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

// ── Persistent session container ────────────────────────────────────
//
// Some tools (browser primitives) need state across invocations —
// chromium's open tabs, CDP connection, form values, JS heap. Spinning
// up a fresh container per tool call loses all of that. For those
// tools we keep one long-lived container per session and exec into it.
//
// Active containers are tracked in a module-local Map so SIGTERM can
// kill them all. Each container is named `foundry-sess-<sessionId>`.

const activeSessionContainers = new Map<string, string>()

export interface SessionContainerOpts {
  sessionId:   string
  workspace:   string
  secretsDir:  string | null
  image:       string
  memoryMb:    number
  cpus:        number
  pidsLimit:   number
  nofileSoft:  number
  nofileHard:  number
  tmpfsMb:     number
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
    ...(opts.secretsDir ? ['-v', `${opts.secretsDir}:/foundry-secrets:ro`] : []),
    opts.image,
    // Keep the container alive. Browser / other stateful tools spawn
    // their own daemons (chromium --remote-debugging-port=…) inside.
    'sleep', 'infinity',
  ]
  return new Promise((resolve, reject) => {
    const child = spawn('podman', args)
    let err = ''
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('close', (code) => {
      if (code === 0) {
        activeSessionContainers.set(opts.sessionId, name)
        resolve(name)
      } else reject(new Error(`podman run failed (${code}): ${err.trim()}`))
    })
  })
}

export interface ExecInContainerResult {
  stdout:   string
  stderr:   string
  exitCode: number
}

export function execInContainer(
  containerName: string, command: string,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<ExecInContainerResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const child = spawn('podman', ['exec', '-i', ...envArgs, containerName, 'sh', '-c', command])
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
  return new Promise(resolve => {
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) stderr += (stderr ? '\n' : '') + 'timeout'
      resolve({ stdout, stderr, exitCode: code ?? -1 })
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
