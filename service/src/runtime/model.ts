import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, badRequest } from '../functional.js'

// LLM model resolution. The agent owns a provider_id (FK to a provider row),
// which carries both the SDK type ('anthropic'/'openai') and the user's API
// key. agent.model is just the model id with no provider prefix.
// resolveModelWithDefaults wraps the base model with defaultSettingsMiddleware
// so per-agent defaults (max tokens, temperature, anthropic thinking budget)
// are baked in once and the step-call site stays clean.

type ProviderFactory = (apiKey: string) => { languageModel: (id: string) => LanguageModelV3 }

const factories: Record<string, ProviderFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

export const supported = Object.keys(factories)

export function resolveModel(db: Db, providerId: string, modelId: string): LanguageModelV3 {
  const row = require(database.providerGet(db, providerId), `provider '${providerId}' not found`)
  const factory = factories[row.type]
  if (!factory) throw badRequest(`unsupported provider type '${row.type}'`)
  return factory(row.api_key).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature     = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    model:      resolveModel(db, agentDef.provider_id, agentDef.model),
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
