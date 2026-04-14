import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool as aiTool } from 'ai'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import type { Connection } from '../tables.js'
import type { ConnectionToolCtx, ConnectionToolDef } from '../connections/types.js'
import { asText, runCommand, toolUseId } from './shared.js'
import { filterTools } from './registry.js'
import { toolsByKind } from './conn/registry.js'

export interface ConnectionServerCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
}

// Wrap a connection's tool set as an MCP server (Claude Agent SDK).
// Returns null if the kind contributes no tools — callers skip mounting.

export function connectionTools(kind: string): ConnectionToolDef[] {
  return toolsByKind[kind] ?? []
}

export function connectionServerKey(kind: string, conn: Connection): string {
  return `${kind}:${conn.name}`
}

function parseConnCtx(conn: Connection): ConnectionToolCtx {
  let secrets: Record<string, string>  = {}
  let config:  Record<string, unknown> = {}
  try { secrets = JSON.parse(conn.secrets) as Record<string, string>  } catch { /* malformed */ }
  try { config  = JSON.parse(conn.config)  as Record<string, unknown> } catch { /* malformed */ }
  return { secrets, config, connectionId: conn.id, connectionName: conn.name }
}

export function buildConnectionServer(
  sctx: ConnectionServerCtx, conn: Connection, allowed?: string[] | '*' | null,
) {
  const tools = connectionTools(conn.kind)
  if (!tools.length) return null
  const toolCtx = parseConnCtx(conn)
  const all = tools.map(t => sdkTool(
    t.name, t.description, t.parameters.shape,
    async (args, extra) => {
      const spec = t.run(args as never, toolCtx)
      const r = await runCommand(
        sctx.db, sctx.config, sctx.sessionId, sctx.workspace,
        spec.command, t.name, args,
        {
          network:      spec.network ?? false,
          mount:        spec.mount   ?? 'none',
          env:          spec.env     ?? {},
          artifactsIn:  spec.artifactsIn,
          artifactsOut: spec.artifactsOut,
          toolUseId:    toolUseId(extra),
        },
      )
      return asText(t.parse ? t.parse(r) : { stdout: r.stdout, exitCode: r.exitCode })
    },
  ))
  return createSdkMcpServer({ name: connectionServerKey(conn.kind, conn), tools: filterTools(all, allowed) })
}

// Vercel ai SDK adapter. Flat record; tool keys prefixed with kind-name-tool
// (colons are not legal in ai-SDK tool names).

function executeAiTool(
  sctx: ConnectionServerCtx, toolCtx: ConnectionToolCtx, def: ConnectionToolDef,
): (args: unknown) => Promise<unknown> {
  return async (args: unknown) => {
    const spec = def.run(args as never, toolCtx)
    const r = await runCommand(
      sctx.db, sctx.config, sctx.sessionId, sctx.workspace,
      spec.command, def.name, args,
      {
        network:      spec.network ?? false,
        mount:        spec.mount   ?? 'none',
        env:          spec.env     ?? {},
        artifactsIn:  spec.artifactsIn,
        artifactsOut: spec.artifactsOut,
      },
    )
    return def.parse ? def.parse(r) : { stdout: r.stdout, exitCode: r.exitCode }
  }
}

export function buildConnectionAiTools(
  sctx: ConnectionServerCtx, conn: Connection, allowed?: string[] | '*' | null,
): Record<string, ReturnType<typeof aiTool>> {
  const tools = connectionTools(conn.kind)
  if (!tools.length) return {}
  const toolCtx = parseConnCtx(conn)
  const out: Record<string, ReturnType<typeof aiTool>> = {}
  for (const def of tools) {
    if (allowed && allowed !== '*' && !allowed.includes(def.name)) continue
    const key = `${conn.kind}-${conn.name}-${def.name}`
    out[key] = aiTool({
      description: def.description,
      inputSchema: def.parameters,
      execute:     executeAiTool(sctx, toolCtx, def),
    }) as unknown as ReturnType<typeof aiTool>
  }
  return out
}
