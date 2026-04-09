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
import database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef } from '../schema.js'
import { slugify, badRequest, notFound } from '../functional.js'

const execFileAsync = promisify(execFile)

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE
// ════════════════════════════════════════════════════════════════════════════
// Per-session working tree: clone the project's bare repo into a tmpdir,
// let the agent mutate it, then push any changes back and destroy the dir.

const workspace = {
  empty: async (): Promise<string> =>
    mkdtemp(join(tmpdir(), 'foundry-session-')),

  clone: async (db: Db, config: Config, projectId: string): Promise<string> => {
    const proj = database.project.get(db, projectId)
    if (!proj) throw new Error(`project ${projectId} not found`)
    const slug = slugify(proj.name)
    const workDir = await workspace.empty()
    const bare = join(config.repoBase, `${slug}.git`)
    await execFileAsync('git', ['clone', bare, workDir])
    await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
    await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Foundry'])
    return workDir
  },

  publish: async (workDir: string): Promise<void> => {
    // Stage and commit any changes the agent made
    await execFileAsync('git', ['-C', workDir, 'add', '-A'])
    try {
      await execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet'])
      // No changes to commit
    } catch {
      // There are staged changes — commit and push
      await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
      const { stdout: branch } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
      await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch.trim()}`])
    }
  },

  destroy: async (workDir: string): Promise<void> => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  },
}

// ════════════════════════════════════════════════════════════════════════════
// CONTAINER
// ════════════════════════════════════════════════════════════════════════════
// Podman-based sandbox runner. Wraps the user command to capture cgroup +
// network stats on exit via a sentinel delimiter on stdout so we can parse
// them out without polluting user-visible output.

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

export function spawnRun(opts: RunOptions): RunHandle {
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
    const userLines  = delimIdx >= 0 ? allStdout.slice(0, delimIdx) : allStdout
    const statsLines = delimIdx >= 0 ? allStdout.slice(delimIdx + 1) : []

    // Emit user stdout lines
    for (const line of userLines) emitter.emit('stdout', line)

    const stats = parseStats(statsLines, timedOut)
    emitter.emit('exit', code ?? -1, stats)
  })

  return { emitter, kill: () => child.kill('SIGKILL') }
}

// ════════════════════════════════════════════════════════════════════════════
// MODEL
// ════════════════════════════════════════════════════════════════════════════
// LLM provider resolution. Models are wrapped with defaultSettingsMiddleware
// to bake in per-agent defaults (max tokens, temperature, reasoning budget)
// so the step call site stays clean. Per-call params still override defaults.

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
  const row = database.provider.getByName(db, providerId)
  if (!row) throw notFound(`provider '${providerId}' not configured — add an API key first`)
  const factory = factories[providerId]
  if (!factory) throw badRequest(`unsupported provider '${providerId}'`)
  return factory(row.api_key).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const base = resolveModel(db, agentDef.model)
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = {
    maxOutputTokens: agentDef.max_tokens,
  }
  if (agentDef.temperature !== null) settings.temperature = agentDef.temperature
  if (agentDef.reasoning_budget !== null) {
    settings.providerOptions = {
      anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
    }
  }
  return wrapLanguageModel({
    model: base,
    middleware: defaultSettingsMiddleware({ settings }),
  })
}

// ════════════════════════════════════════════════════════════════════════════

export { workspace }
