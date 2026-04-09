import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { type Db } from '../database.js'
import database from '../database.js'
import { badRequest, notFound } from '../functional.js'

type ProviderFactory = (apiKey: string) => { languageModel: (id: string) => LanguageModelV3 }

const factories: Record<string, ProviderFactory> = {
  anthropic: (key) => createAnthropic({ apiKey: key }),
  openai:    (key) => createOpenAI({ apiKey: key }),
}

export const supported = Object.keys(factories)

export const resolveModel = (db: Db) => (modelString: string): LanguageModelV3 => {
  const sep = modelString.indexOf(':')
  if (sep === -1) throw badRequest('model must be provider:model format')
  const providerId = modelString.slice(0, sep)
  const modelId = modelString.slice(sep + 1)
  const row = database.provider.getByName(db, providerId)
  if (!row) throw notFound(`provider '${providerId}' not configured — add an API key first`)
  const factory = factories[providerId]
  if (!factory) throw badRequest(`unsupported provider '${providerId}'`)
  return factory(row.api_key).languageModel(modelId)
}
