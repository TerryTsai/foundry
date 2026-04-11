import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, badRequest } from '../functional.js'

// LLM model resolution. The agent owns a connection_id (FK to a connection row).
// The connection's `kind` selects the SDK factory ('anthropic', 'openai'); the
// API key lives in the connection's `secrets` JSON blob under `api_key`.
// agent.model is just the model id with no prefix.
// resolveModelWithDefaults wraps the base model with defaultSettingsMiddleware
// so per-agent defaults (max tokens, temperature, anthropic thinking budget)
// are baked in once and the step-call site stays clean.

type ModelFactory = (apiKey: string) => { languageModel: (id: string) => LanguageModelV3 }

const factories: Record<string, ModelFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

// Connection kinds accepted at create time. 'anthropic-subscription' has no
// factory here because it bypasses resolveModel entirely — the runner
// dispatches it to runtime/sdk-runner.ts which uses the Claude Agent SDK
// directly with the access_token field from secrets.
export const supported = [...Object.keys(factories), 'anthropic-subscription']

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

export function resolveModel(db: Db, connectionId: string, modelId: string): LanguageModelV3 {
  const row = require(database.connectionGet(db, connectionId), `connection '${connectionId}' not found`)
  const factory = factories[row.kind]
  if (!factory) throw badRequest(`unsupported connection kind '${row.kind}'`)
  return factory(secretFor(row, 'api_key')).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature     = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    model:      resolveModel(db, agentDef.connection_id, agentDef.model),
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
