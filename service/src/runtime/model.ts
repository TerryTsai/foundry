import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, badRequest } from '../functional.js'

// LLM model resolution for API-key-based connections. The agent owns a
// connection_id; the connection's `kind` picks the SDK factory
// ('anthropic', 'openai'); the API key lives in `secrets.api_key`.
// agent.model is the bare model id (no connection prefix).
//
// resolveModelWithDefaults wraps the base model with
// defaultSettingsMiddleware so per-agent defaults (max tokens, temperature,
// reasoning_budget) are baked in once and callers stay clean.
//
// 'anthropic-subscription' has no factory here — it's dispatched in
// runner.ts to sdk-runner.ts, which uses the Claude Agent SDK directly.
//
// The return type is intentionally untyped here: the installed versions
// of `ai` and the adapters (`@ai-sdk/anthropic`, `@ai-sdk/openai`) can
// resolve different `@ai-sdk/provider` majors in the same workspace.
// Pinning to a specific LanguageModelV_X symbol locks us to one side
// of that drift. The caller (generateText) accepts whatever each adapter
// returns, so we let inference carry it through.

type ModelFactory = (apiKey: string) => ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI>

const factories: Record<string, ModelFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

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

export function resolveModel(db: Db, connectionId: string, modelId: string) {
  const row = require(database.connectionGet(db, connectionId), `connection '${connectionId}' not found`)
  const factory = factories[row.kind]
  if (!factory) throw badRequest(`unsupported connection kind '${row.kind}'`)
  return factory(secretFor(row, 'api_key')).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef) {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature !== null) settings.temperature = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    model:      resolveModel(db, agentDef.connection_id, agentDef.model),
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
