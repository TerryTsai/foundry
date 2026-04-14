import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool as aiTool } from 'ai'

import type { Db } from '../database.js'
import type { Config } from '../config.js'
import type { Connection } from '../schema.js'
import { asText, runCommand, toolUseId } from '../mcp/_shared.js'
import { filterTools } from '../mcp/registry.js'
import type { ConnectionProvider, ConnectionToolCtx, ConnectionToolDef } from './provider.js'

export interface ConnectionServerCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
}

// ════════════════════════════════════════════════════════════════════════════
// buildConnectionServer
// ════════════════════════════════════════════════════════════════════════════
// Wrap a provider's tool defs as an MCP server. Each tool runs through
// runCommand, which spawns a podman container and writes an execution
// row. Same invariants as every other tool in the system:
//
//   - Sandboxed execution (cgroup limits, network / mount scoped)
//   - Execution row per invocation
//   - tool_use_id correlation to the activity row
//   - Secrets live in env only, never serialized
//
// Returns null if the provider declares no tools — callers use that to
// skip mounting the server entirely.

export function buildConnectionServer(
  sctx: ConnectionServerCtx,
  provider: ConnectionProvider,
  conn: Connection,
  allowed?: string[] | '*' | null,
) {
  if (!provider.tools?.length) return null

  let secrets: Record<string, string>  = {}
  let config:  Record<string, unknown> = {}
  try { secrets = JSON.parse(conn.secrets) as Record<string, string>  } catch { /* malformed */ }
  try { config  = JSON.parse(conn.config)  as Record<string, unknown> } catch { /* malformed */ }

  const toolCtx: ConnectionToolCtx = {
    secrets,
    config,
    connectionId:   conn.id,
    connectionName: conn.name,
  }

  const all = provider.tools.map(t => sdkTool(
    t.name,
    t.description,
    t.parameters.shape,
    async (args, extra) => {
      const spec = t.run(args as never, toolCtx)
      const r = await runCommand(
        sctx.db, sctx.config, sctx.sessionId, sctx.workspace,
        spec.command,
        t.name,
        args,
        {
          network:      spec.network ?? false,
          mount:        spec.mount   ?? 'none',
          env:          spec.env     ?? {},
          artifactsIn:  spec.artifactsIn,
          artifactsOut: spec.artifactsOut,
          toolUseId:    toolUseId(extra),
        },
      )
      const result = t.parse ? t.parse(r) : { stdout: r.stdout, exitCode: r.exitCode }
      return asText(result)
    },
  ))

  return createSdkMcpServer({
    name:  `${provider.kind}:${conn.name}`,
    tools: filterTools(all, allowed),
  })
}

// Key used in `agent.tools` selection and as the MCP server name for
// a connection-contributed server. Built-ins use single-token names
// (`foundry`, `github`, `sandbox`, `browser`); connections use
// `<kind>:<name>` (`cloudflare:prod`, `slack:founder`). The colon
// distinguishes the two classes.
export function connectionServerKey(provider: ConnectionProvider, conn: Connection): string {
  return `${provider.kind}:${conn.name}`
}

// ════════════════════════════════════════════════════════════════════════════
// buildConnectionAiTools
// ════════════════════════════════════════════════════════════════════════════
// Same contract, different adapter. Wraps a provider's tool defs as a
// flat Vercel ai-SDK ToolSet record so the ai-SDK runner can mount them
// alongside the built-in buildAi() outputs. Tool names are prefixed
// with the connection name so they don't collide across connections
// of the same provider kind (e.g. two Cloudflare connections on
// different accounts).

function executeTool(
  sctx: ConnectionServerCtx,
  toolCtx: ConnectionToolCtx,
  def: ConnectionToolDef,
): (args: unknown) => Promise<unknown> {
  return async (args: unknown) => {
    const spec = def.run(args as never, toolCtx)
    const r = await runCommand(
      sctx.db, sctx.config, sctx.sessionId, sctx.workspace,
      spec.command,
      def.name,
      args,
      {
        network:      spec.network ?? false,
        mount:        spec.mount   ?? 'none',
        env:          spec.env     ?? {},
        artifactsIn:  spec.artifactsIn,
        artifactsOut: spec.artifactsOut,
        // ai-SDK runner has no _meta.toolUseId equivalent; activities are
        // correlated post-hoc via the session's backfill pass.
      },
    )
    return def.parse ? def.parse(r) : { stdout: r.stdout, exitCode: r.exitCode }
  }
}

export function buildConnectionAiTools(
  sctx: ConnectionServerCtx,
  provider: ConnectionProvider,
  conn: Connection,
  allowed?: string[] | '*' | null,
): Record<string, ReturnType<typeof aiTool>> {
  if (!provider.tools?.length) return {} as Record<string, ReturnType<typeof aiTool>>

  let secrets: Record<string, string>  = {}
  let config:  Record<string, unknown> = {}
  try { secrets = JSON.parse(conn.secrets) as Record<string, string>  } catch { /* malformed */ }
  try { config  = JSON.parse(conn.config)  as Record<string, unknown> } catch { /* malformed */ }

  const toolCtx: ConnectionToolCtx = {
    secrets, config,
    connectionId:   conn.id,
    connectionName: conn.name,
  }

  const out: Record<string, ReturnType<typeof aiTool>> = {}
  for (const def of provider.tools) {
    if (allowed && allowed !== '*' && !allowed.includes(def.name)) continue
    // ai-SDK has no server concept — tools live in a flat map. Same
    // information as the Agent-SDK server name (kind + conn name +
    // tool) but joined with dashes because ai-SDK tool names can't
    // contain colons. E.g. `cloudflare-prod-zonesList`.
    const key = `${provider.kind}-${conn.name}-${def.name}`
    out[key] = aiTool({
      description: def.description,
      inputSchema: def.parameters,
      execute:     executeTool(sctx, toolCtx, def),
    }) as unknown as ReturnType<typeof aiTool>
  }
  return out
}
