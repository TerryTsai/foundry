import { type Db } from '../database.js'
import * as database from '../database.js'
import { now } from '../functional.js'
import { scrubSecrets } from '../mcp/shared.js'
import { collectOutputs, cleanupDirs, type ExecutionDirs } from './workspace.js'
import type { ArtifactSpec } from '../connections/provider.js'
import type { ContainerStats } from './sandbox.js'

export interface ExitCtx {
  executionId: string
  startTime:   number
  dirs:        ExecutionDirs
  artifactsOut?: ArtifactSpec[]
  stdout:      string[]
  stderr:      string[]
}

export function onExecutionExit(
  db: Db, ctx: ExitCtx, code: number, stats: ContainerStats | null,
): void {
  if (code === 0) collectOutputs(ctx.dirs.workspace, ctx.dirs.outputDir, ctx.artifactsOut)
  cleanupDirs(ctx.dirs.inputDir, ctx.dirs.outputDir, ctx.dirs.statsDir)
  database.executionUpdate(db, ctx.executionId, {
    status:         code === 0 ? 'done' : 'failed',
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
