// In-process adapter for the mcp slice. Only agentMcpList crosses the
// client surface — vendor providers and tool servers are injected
// directly into engine deps at the composition root.

import type { Db } from '@foundry/db'
import { ok } from '@foundry/model'
import * as mcp from '@foundry/mcp'
import { connectionByAccount } from '@foundry/crud'

import type { McpSlice } from '../slices/mcp.js'

export type McpAdapterDeps = { db: Db }

export const createMcpAdapter = (deps: McpAdapterDeps): McpSlice => ({
  agentMcpList: async (ctx) => ok(mcp.agentMcpList(deps.db, ctx.accountId, connectionByAccount)),
})
