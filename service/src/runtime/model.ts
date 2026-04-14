import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, badRequest } from '../functional.js'
import { providerGet } from '../connections/registry.js'

// LLM model resolution for API-key-based connections. Delegates to the
// connection provider's `modelFactory`. The Vercel ai SDK runner calls
// `resolveModelWithDefaults` at session start; the Claude Agent SDK path
// (`anthropic-subscription` kind) bypasses this entirely — its provider
// has no modelFactory.

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
  const provider = providerGet(row.kind)
  if (!provider) throw badRequest(`unsupported connection kind '${row.kind}'`)
  if (!provider.modelFactory) throw badRequest(`connection kind '${row.kind}' has no modelFactory — cannot serve as an LLM provider`)
  const factory = provider.modelFactory(secretFor(row, 'api_key')) as { languageModel: (id: string) => unknown }
  return factory.languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef) {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature      = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see model-factory drift note in connections/provider.ts
    model:      resolveModel(db, agentDef.connection_id, agentDef.model) as any,
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
