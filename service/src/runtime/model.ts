import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { require, badRequest } from '../functional.js'

// LLM provider resolution. resolveModelWithDefaults wraps the base model
// with defaultSettingsMiddleware so per-agent defaults (max tokens,
// temperature, anthropic thinking budget) are baked in once and the
// step-call site stays clean. Per-call params still override defaults.

type ProviderFactory = (apiKey: string) => { languageModel: (id: string) => LanguageModelV3 }

const factories: Record<string, ProviderFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

export const supported = Object.keys(factories)

export function resolveModel(db: Db, modelString: string): LanguageModelV3 {
  const sep = modelString.indexOf(':')
  if (sep === -1) throw badRequest('model must be provider:model format')
  const providerId = modelString.slice(0, sep)
  const modelId    = modelString.slice(sep + 1)
  const factory    = factories[providerId]
  if (!factory) throw badRequest(`unsupported provider '${providerId}'`)
  const row = require(database.providerGetByName(db, providerId), `provider '${providerId}' not configured — add an API key first`)
  return factory(row.api_key).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature     !== null) settings.temperature     = agentDef.temperature
  if (agentDef.reasoning_budget !== null) settings.providerOptions = {
    anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
  }
  return wrapLanguageModel({
    model:      resolveModel(db, agentDef.model),
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
