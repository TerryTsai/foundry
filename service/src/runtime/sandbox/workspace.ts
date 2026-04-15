// Sandbox execution directories and row finalization. Covers the full
// host-side lifecycle of one container run: create the input/output/stats
// dirs, copy artifacts in, then (on exit) copy artifacts out, clean up,
// and write the execution row.

import { mkdirSync, cpSync, rmSync } from 'fs'
import { join, dirname } from 'path'

import { type Db } from '../../database.js'
import * as database from '../../database.js'
import { now } from '../../util.js'
import { scrubSecrets } from '../../mcp/shared.js'
import type { ContainerStats } from './podman.js'

// Artifact copy spec — drives the isolated-sandbox model. `artifactsIn`
// entries are copied host→container before the command runs (destination
// under /input). `artifactsOut` entries are copied container→host after a
// successful exit (source under /output, destination relative to the
// agent's /work). When either is present, /work itself is NOT mounted —
// the command can only see what's in the input allowlist.
export interface ArtifactSpec {
  src:  string   // path relative to workspace (artifactsIn) or /output (artifactsOut)
  dest: string   // path relative to /input (artifactsIn) or workspace (artifactsOut)
}

export interface ExecutionDirs {
  workspace: string
  statsDir:  string
  inputDir:  string | null
  outputDir: string | null
  isolated:  boolean
}

function copyIn(baseSrc: string, a: ArtifactSpec, baseDst: string): void {
  const src = join(baseSrc, a.src)
  const dst = join(baseDst, a.dest)
  mkdirSync(dirname(dst), { recursive: true })
  cpSync(src, dst, { recursive: true })
}

export function prepareWorkspace(input: {
  executionId:   string
  workspace?:    string
  artifactsIn?:  ArtifactSpec[]
  artifactsOut?: ArtifactSpec[]
}): ExecutionDirs {
  const workspace = input.workspace ?? `/tmp/foundry-exec-${input.executionId}`
  const statsDir  = `/tmp/foundry-stats-${input.executionId}`
  mkdirSync(workspace, { recursive: true })
  mkdirSync(statsDir, { recursive: true })

  const isolated  = (input.artifactsIn?.length ?? 0) > 0 || (input.artifactsOut?.length ?? 0) > 0
  const inputDir  = isolated && input.artifactsIn  ? `/tmp/foundry-in-${input.executionId}`  : null
  const outputDir = isolated && input.artifactsOut ? `/tmp/foundry-out-${input.executionId}` : null
  if (inputDir) {
    mkdirSync(inputDir, { recursive: true })
    for (const a of input.artifactsIn!) copyIn(workspace, a, inputDir)
  }
  if (outputDir) mkdirSync(outputDir, { recursive: true })
  return { workspace, statsDir, inputDir, outputDir, isolated }
}

// Copy container /output artifacts back into the host workspace. Called on
// success; silently skips missing sources (tool-output contract: declared
// outputs that didn't get produced are not fatal).
function collectOutputs(workspace: string, outputDir: string | null, artifactsOut?: ArtifactSpec[]): void {
  if (!outputDir || !artifactsOut) return
  for (const a of artifactsOut) {
    const src = join(outputDir, a.src)
    const dst = join(workspace, a.dest)
    try {
      mkdirSync(dirname(dst), { recursive: true })
      cpSync(src, dst, { recursive: true })
    } catch { /* absent artifact is not fatal */ }
  }
}

function cleanupDirs(...dirs: Array<string | null>): void {
  for (const d of dirs) if (d) try { rmSync(d, { recursive: true, force: true }) } catch {}
}

export interface ExitCtx {
  executionId:   string
  startTime:     number
  dirs:          ExecutionDirs
  artifactsOut?: ArtifactSpec[]
  stdout:        string[]
  stderr:        string[]
}

export function finishExecution(
  db: Db, ctx: ExitCtx, code: number, stats: ContainerStats | null,
): void {
  if (code === 0) collectOutputs(ctx.dirs.workspace, ctx.dirs.outputDir, ctx.artifactsOut)
  cleanupDirs(ctx.dirs.inputDir, ctx.dirs.outputDir, ctx.dirs.statsDir)
  database.executionUpdate(db, ctx.executionId, {
    status:         code === 0 ? 'finished' : 'failed',
    exit_code:      code,
    ended_at:       now(),
    duration_ms:    Date.now() - ctx.startTime,
    stdout:         scrubSecrets(ctx.stdout.join('\n') || null),
    stderr:         scrubSecrets(ctx.stderr.join('\n') || null),
    exit_signal:    stats?.exitSignal ?? null,
    peak_memory_mb: stats?.peakMemoryMb ?? null,
    cpu_ms:         stats?.cpuMs ?? null,
    net_rx_bytes:   stats?.netRxBytes ?? null,
    net_tx_bytes:   stats?.netTxBytes ?? null,
  })
}
