import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require } from '../functional.js'
import { badRequest } from '../errors.js'
import { modelFactoryByKind } from './models.js'

// LLM model resolution for API-key-based connections. The Claude Agent SDK
// path (`anthropic-subscription`) bypasses this — it's not in `modelFactoryByKind`.

function secretFor(conn: { secrets: string }, field: string): string {
  try {
    const parsed = JSON.parse(conn.secrets) as Record<string, unknown>
    const v = parsed[field]
    if (typeof v !== 'string' || !v) throw new Error(`missing ${field}`)
    return v
  } catch (err) {
    throw badRequest(`connection secrets invalid: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function resolveModel(db: Db, connectionId: string, modelId: string) {
  const row = require(database.connectionGet(db, connectionId), `connection '${connectionId}' not found`)
  const factory = modelFactoryByKind[row.kind]
  if (!factory) throw badRequest(`connection kind '${row.kind}' has no model factory — cannot serve as an LLM provider`)
  return factory(secretFor(row, 'api_key')).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef) {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature      = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ai-sdk provider type drifts across adapter versions
    model:      resolveModel(db, agentDef.connection_id, agentDef.model) as any,
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
