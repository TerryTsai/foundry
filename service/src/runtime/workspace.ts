import { mkdirSync, cpSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import type { ArtifactSpec } from '../connections/types.js'

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
export function collectOutputs(
  workspace: string, outputDir: string | null, artifactsOut?: ArtifactSpec[],
): void {
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

export function cleanupDirs(...dirs: Array<string | null>): void {
  for (const d of dirs) if (d) try { rmSync(d, { recursive: true, force: true }) } catch {}
}
