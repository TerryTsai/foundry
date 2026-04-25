// In-process adapter for the mcp slice. Only agentMcpList crosses the
// client surface — vendor providers and tool servers are injected
// directly into engine deps at the composition root.

import type { Db } from '@foundry/db'
import type { AppError, McpError } from '@foundry/model'
import * as mcp from '@foundry/mcp'
import { connectionByAccount } from '@foundry/crud'

import type { McpSlice } from '../slices/mcp.js'
import { wrap } from './wrap.js'

export type McpAdapterDeps = { db: Db }

const toMcpError = (e: AppError): McpError =>
  ({ kind: 'internal', message: e.message })

const w = <T>(fn: () => T | Promise<T>) => wrap<T, McpError>(fn, toMcpError)

export const createMcpAdapter = (deps: McpAdapterDeps): McpSlice => ({
  agentMcpList: (ctx) => w(() => mcp.agentMcpList(deps.db, ctx.accountId, connectionByAccount)),
})
