import { eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Agent } from '../tables.js'
import { mustExist, now } from '../util.js'
import { conflict, badRequest, notFound } from '../errors.js'
import * as providers from '../connections/registry.js'
import { registry as mcpRegistry, byConnectionKind, type McpServerInfo } from '../mcp/registry.js'
import * as validate from '../validate.js'

// MCP server catalog surfaced to the agent-edit UI. Returns the built-ins
// plus one synthesized entry per account connection whose kind has a
// matching MCP module. The id/key (`<kind>:<name>`) is the same one the
// runtime uses when mounting the Agent-SDK server.
export function agentMcpList(db: Db, accountId: string): McpServerInfo[] {
  const out: McpServerInfo[] = [...mcpRegistry]
  const conns = database.connectionAll(db, [eq(schema.connection.account_id, accountId)])
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    const provider = providers.providerGet(conn.kind)
    if (!mod || !provider) continue
    out.push({
      id:          `${provider.kind}:${conn.name}` as never,
      name:        `${provider.name} · ${conn.name}`,
      category:    mod.info.category,
      description: `Connection-backed tools from ${provider.name} (${conn.name}).`,
      tools:       mod.info.tools,
    })
  }
  return out
}

export function agentList(db: Db, filters: z.infer<typeof validate.agentList>): Agent[] {
  // Hide superseded versions — the list UI only shows the current row per
  // (account, name). Historical versions remain reachable by id.
  const base = [isNull(schema.agent.superseded_at)]
  if (filters.accountId) return database.agentAll(db, [eq(schema.agent.account_id, filters.accountId), ...base])
  return database.agentAll(db, base)
}

export function agentGet(db: Db, id: string): Agent {
  return mustExist(database.agentGet(db, id))
}

export function agentCreate(db: Db, accountId: string, input: z.infer<typeof validate.agentCreate>): Agent {
  const { connection_id, name, model, description, max_tokens, max_steps, temperature, reasoning_budget, tools, verifiers } = input
  mustExist(database.connectionGet(db, connection_id), `connection '${connection_id}' not found`)
  const current = database.agentAll(db, [
    eq(schema.agent.account_id, accountId),
    eq(schema.agent.name, name),
    isNull(schema.agent.superseded_at),
  ])
  if (current.length > 0) throw conflict(`agent '${name}' already exists for this account`)
  return database.agentInsert(db, {
    account_id: accountId, connection_id, name, model, description,
    max_tokens: max_tokens ?? 8192, max_steps: max_steps ?? 20,
    temperature: temperature ?? null,
    reasoning_budget: reasoning_budget ?? null,
    tools:     tools     ? JSON.stringify(tools)     : null,
    verifiers: verifiers ? JSON.stringify(verifiers) : null,
    superseded_at: null,
    created_at:   now(),
  })
}

// Agents are immutable. "Update" creates a new version; the prior row is
// marked superseded. Historical sessions keep pointing at their original
// version so metrics stay comparable.
export function agentUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.agentUpdate>): Agent {
  const prior = mustExist(database.agentGet(db, id))
  if (prior.account_id !== accountId) throw notFound()
  if (prior.superseded_at !== null) throw badRequest('cannot update a superseded agent version; start from the current one')
  if (input.connection_id) mustExist(database.connectionGet(db, input.connection_id), `connection '${input.connection_id}' not found`)

  const newRow = db.transaction(tx => {
    const d = tx as any
    const t = now()
    database.agentUpdate(d, prior.id, { superseded_at: t })
    return database.agentInsert(d, {
      account_id:       prior.account_id,
      connection_id:    input.connection_id    ?? prior.connection_id,
      name:             prior.name,
      description:      input.description      ?? prior.description,
      model:            input.model            ?? prior.model,
      max_tokens:       input.max_tokens       ?? prior.max_tokens,
      max_steps:        input.max_steps        ?? prior.max_steps,
      temperature:      input.temperature      ?? prior.temperature,
      reasoning_budget: input.reasoning_budget ?? prior.reasoning_budget,
      tools:            input.tools !== undefined
                          ? JSON.stringify(input.tools)
                          : prior.tools,
      verifiers:        input.verifiers !== undefined
                          ? (input.verifiers ? JSON.stringify(input.verifiers) : null)
                          : prior.verifiers,
      superseded_at:    null,
      created_at:       t,
    })
  })
  return newRow as Agent
}

export function agentRemove(db: Db, accountId: string, id: string): { ok: true } {
  const row = mustExist(database.agentGet(db, id))
  if (row.account_id !== accountId) throw notFound()
  database.agentRemove(db, id)
  return { ok: true }
}
