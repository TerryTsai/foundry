import { eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Agent } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { ok, err, now } from '@foundry/model'
import type { agent as validate } from './schema.js'
import * as database from './repo.js'

export function agentList(db: Db, filters: z.infer<typeof validate.list>): Result<Agent[], CrudError> {
  // Hide superseded versions — list UI only shows the current row per
  // (account, name). Historical versions remain reachable by id.
  const base = [isNull(schema.agent.superseded_at)]
  if (filters.accountId) return ok(database.agentAll(db, [eq(schema.agent.account_id, filters.accountId), ...base]))
  return ok(database.agentAll(db, base))
}

export function agentGet(db: Db, accountId: string, id: string): Result<Agent, CrudError> {
  const row = database.agentGet(db, id)
  if (!row || row.account_id !== accountId) return err({ kind: 'not_found', entity: 'agent', id })
  return ok(row)
}

export function agentCreate(db: Db, accountId: string, input: z.infer<typeof validate.create>): Result<Agent, CrudError> {
  const { connection_id, name } = input
  if (!database.connectionGet(db, connection_id)) {
    return err({ kind: 'not_found', entity: 'connection', id: connection_id })
  }
  const current = agentCurrentByName(db, accountId, name)
  if (current.length > 0) return err({ kind: 'conflict', reason: `agent '${name}' already exists for this account` })
  return ok(database.agentInsert(db, agentCreatePayload(accountId, input)))
}

function agentCurrentByName(db: Db, accountId: string, name: string): Agent[] {
  return database.agentAll(db, [
    eq(schema.agent.account_id, accountId),
    eq(schema.agent.name, name),
    isNull(schema.agent.superseded_at),
  ])
}

function agentCreatePayload(accountId: string, input: z.infer<typeof validate.create>): Record<string, unknown> {
  const { connection_id, name, model, description, max_tokens, max_steps, temperature, reasoning_budget, tools, verifiers } = input
  return {
    account_id: accountId, connection_id, name, model, description,
    max_tokens: max_tokens ?? 8192, max_steps: max_steps ?? 20,
    temperature: temperature ?? null, reasoning_budget: reasoning_budget ?? null,
    tools:     tools     ? JSON.stringify(tools)     : null,
    verifiers: verifiers ? JSON.stringify(verifiers) : null,
    superseded_at: null, created_at: now(),
  }
}

// Agents are immutable. "Update" creates a new version; the prior row is
// marked superseded. Historical sessions keep pointing at their original.
export function agentUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.update>): Result<Agent, CrudError> {
  const prior = database.agentGet(db, id)
  if (!prior || prior.account_id !== accountId) return err({ kind: 'not_found', entity: 'agent', id })
  if (prior.superseded_at !== null) return err({ kind: 'validation_failed', field: 'id', reason: 'cannot update a superseded agent version; start from the current one' })
  if (input.connection_id && !database.connectionGet(db, input.connection_id)) {
    return err({ kind: 'not_found', entity: 'connection', id: input.connection_id })
  }
  return ok(agentSupersedeAndInsert(db, prior, input))
}

function agentSupersedeAndInsert(db: Db, prior: Agent, input: z.infer<typeof validate.update>): Agent {
  return db.transaction(tx => {
    // Drizzle's tx handle has the same surface as Db (select/insert/update),
    // but its declared type is a transaction-scoped subtype. The repo
    // helpers all accept Db; the cast names that intent without `any`.
    const d = tx as unknown as Db
    const t = now()
    database.agentUpdate(d, prior.id, { superseded_at: t })
    return database.agentInsert(d, agentUpdatePayload(prior, input, t))
  })
}

function agentUpdatePayload(prior: Agent, input: z.infer<typeof validate.update>, t: string): Record<string, unknown> {
  return {
    account_id:       prior.account_id,
    connection_id:    input.connection_id    ?? prior.connection_id,
    name:             prior.name,
    description:      input.description      ?? prior.description,
    model:            input.model            ?? prior.model,
    max_tokens:       input.max_tokens       ?? prior.max_tokens,
    max_steps:        input.max_steps        ?? prior.max_steps,
    temperature:      input.temperature      ?? prior.temperature,
    reasoning_budget: input.reasoning_budget ?? prior.reasoning_budget,
    tools:            input.tools !== undefined ? JSON.stringify(input.tools) : prior.tools,
    verifiers:        agentUpdateVerifiers(prior, input),
    superseded_at:    null, created_at: t,
  }
}

function agentUpdateVerifiers(prior: Agent, input: z.infer<typeof validate.update>): string | null {
  if (input.verifiers === undefined) return prior.verifiers
  return input.verifiers ? JSON.stringify(input.verifiers) : null
}

export function agentRemove(db: Db, accountId: string, id: string): Result<{ ok: true }, CrudError> {
  const row = database.agentGet(db, id)
  if (!row || row.account_id !== accountId) return err({ kind: 'not_found', entity: 'agent', id })
  database.agentRemove(db, id)
  return ok({ ok: true })
}
