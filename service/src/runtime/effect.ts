import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, slugify, badRequest, succeeds, toInt } from '../functional.js'

const execFileAsync = promisify(execFile)

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE
// ════════════════════════════════════════════════════════════════════════════

export async function workspaceEmpty(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundry-session-'))
}

export async function workspaceClone(db: Db, config: Config, projectId: string): Promise<string> {
  const proj = require(database.projectGet(db, projectId), `project ${projectId} not found`)
  const workDir = await workspaceEmpty()
  const bare    = join(config.repoBase, `${slugify(proj.name)}.git`)
  await execFileAsync('git', ['clone', bare, workDir])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name',  'Foundry'])
  return workDir
}

export async function workspacePublish(workDir: string): Promise<void> {
  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  // `git diff --cached --quiet` exits non-zero when there are staged changes
  const clean = await succeeds(() => execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet']))
  if (clean) return
  await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
  const { stdout: branch } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch.trim()}`])
}

export async function workspaceDestroy(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
// CONTAINER
// ════════════════════════════════════════════════════════════════════════════

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
    `echo "${STATS_DELIM}"`,
    `cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true`,
    `echo "---"`,
    `cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || echo 0`,
    `echo "---"`,
    `cat /proc/net/dev 2>/dev/null | tail -n+3 || true`,
    `exit $__ec`,
  ].join('\n')
}

function podmanArgs(opts: RunOptions): string[] {
  const { workspace, image, env, network, memoryMb, cpus, pidsLimit, nofileSoft, nofileHard, tmpfsMb, command } = opts
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return [
    'run', '--rm',
    ...(network ? [] : ['--network=none']),
    '--memory', `${memoryMb}m`, '--memory-swap', `${memoryMb}m`,
    '--cpus', String(cpus), '--pids-limit', String(pidsLimit),
    '--ulimit', `nofile=${nofileSoft}:${nofileHard}`,
    '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', `/tmp:rw,size=${tmpfsMb}m`, '--tmpfs', `/run:rw,size=8m`,
    '-v', `${workspace}:/work`, '-w', '/work',
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

function finalize(stdout: string[], emitter: EventEmitter, code: number): void {
  const delimIdx = stdout.indexOf(STATS_DELIM)
  const userLines  = delimIdx >= 0 ? stdout.slice(0, delimIdx) : stdout
  const statsLines = delimIdx >= 0 ? stdout.slice(delimIdx + 1) : []
  userLines.forEach(l => emitter.emit('stdout', l))
  emitter.emit('exit', code, parseStats(statsLines, false))
}

export function spawnRun(opts: RunOptions): RunHandle {
  const child   = spawn('podman', podmanArgs(opts))
  const emitter = new EventEmitter()
  const stdout: string[] = []
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
    emitter.emit('exit', -1, { ...emptyStats(), exitSignal: 'timeout' })
  }, opts.timeoutMs)

  child.stdout.on('data', (d: Buffer) => d.toString().split('\n').forEach(l => l && stdout.push(l)))
  child.stderr.on('data', (d: Buffer) => d.toString().split('\n').forEach(l => l && emitter.emit('stderr', l)))
  child.on('close', (code) => {
    clearTimeout(timeout)
    if (!timedOut) finalize(stdout, emitter, code ?? -1)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}

// ════════════════════════════════════════════════════════════════════════════
// MODEL
// ════════════════════════════════════════════════════════════════════════════

type ProviderFactory = (apiKey: string) => { languageModel: (id: string) => LanguageModelV3 }

const factories: Record<string, ProviderFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

export const supported = Object.keys(factories)

export function resolveModel(db: Db, modelString: string): LanguageModelV3 {
  const sep = modelString.indexOf(':')
  if (sep === -1) throw badRequest('model must be provider:model format')
  const providerId = modelString.slice(0, sep)
  const modelId    = modelString.slice(sep + 1)
  const factory    = factories[providerId]
  if (!factory) throw badRequest(`unsupported provider '${providerId}'`)
  const row = require(database.providerGetByName(db, providerId), `provider '${providerId}' not configured — add an API key first`)
  return factory(row.api_key).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature     = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    model:      resolveModel(db, agentDef.model),
    middleware: defaultSettingsMiddleware({ settings }),
  })
}

