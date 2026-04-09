import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import { badRequest, notFound } from '../functional.js'

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
  const row = database.provider.getByName(db, providerId)
  if (!row) throw notFound(`provider '${providerId}' not configured — add an API key first`)
  const factory = factories[providerId]
  if (!factory) throw badRequest(`unsupported provider '${providerId}'`)
  return factory(row.api_key).languageModel(modelId)
}

// Wrap the base model with agent-specific defaults (max tokens, temperature,
// anthropic thinking budget) so the step call site stays clean. Per-call
// params still override these defaults.
export function resolveModelWithDefaults(db: Db, agentDef: AgentDef): LanguageModelV3 {
  const base = resolveModel(db, agentDef.model)
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = {
    maxOutputTokens: agentDef.max_tokens,
  }
  if (agentDef.temperature !== null) settings.temperature = agentDef.temperature
  if (agentDef.reasoning_budget !== null) {
    settings.providerOptions = {
      anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
    }
  }
  return wrapLanguageModel({
    model: base,
    middleware: defaultSettingsMiddleware({ settings }),
  })
}
