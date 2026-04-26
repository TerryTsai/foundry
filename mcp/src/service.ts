// Wiring for @foundry/mcp. Returns an McpClient backed by agentMcpList.
// mcp can't import @foundry/crud, so the composition root injects the
// connectionByAccount lookup via deps.

import type { Db } from '@foundry/db'
import { ok } from '@foundry/model'

import { agentMcpList } from './agent-mcp-list.js'
import type { ConnectionByAccountFn } from './schema.js'
import type { McpClient } from './client.js'

export type McpServiceDeps = {
  db:                   Db
  connectionByAccount:  ConnectionByAccountFn
}

export const createMcpService = (deps: McpServiceDeps): McpClient => ({
  agentMcpList: async (ctx) => ok(agentMcpList(deps.db, ctx.accountId, deps.connectionByAccount)),
})
