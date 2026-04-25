import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '@foundry/db'
import type { Agent } from '@foundry/db'

import type { EngineDeps } from '../types.js'

// Model factory table — one entry per provider kind that can serve as an
// LLM. The Claude Agent SDK path (kind 'anthropic-subscription') bypasses
// this entirely; its token is consumed by the anthropic loop directly.

type ModelFactory = (apiKey: string) => { languageModel: (id: string) => unknown }

const anthropicModel: ModelFactory = (apiKey) =>
  createAnthropic({ apiKey }) as unknown as { languageModel: (id: string) => unknown }

const openaiModel: ModelFactory = (apiKey) =>
  createOpenAI({ apiKey }) as unknown as { languageModel: (id: string) => unknown }

export const modelFactoryByKind: Record<string, ModelFactory | undefined> = {
  anthropic: anthropicModel,
  openai:    openaiModel,
}

function secretFor(conn: { secrets: string }, field: string, deps: EngineDeps): string {
  const parsed = parseSecrets(conn.secrets, deps)
  const v = parsed[field]
  if (typeof v !== 'string' || !v) throw new Error(`connection secrets invalid: missing ${field}`)
  return v
}

function parseSecrets(blob: string, deps: EngineDeps): Record<string, unknown> {
  try {
    return JSON.parse(deps.crud.decryptSecret(blob)) as Record<string, unknown>
  } catch (errVal) {
    throw new Error(`connection secrets invalid: ${errVal instanceof Error ? errVal.message : String(errVal)}`)
  }
}

export function resolveModel(db: Db, deps: EngineDeps, connectionId: string, modelId: string) {
  const row = deps.crud.connectionGetById(db, connectionId)
  if (!row) throw new Error(`connection '${connectionId}' not found`)
  const factory = modelFactoryByKind[row.kind]
  if (!factory) throw new Error(`connection kind '${row.kind}' has no model factory — cannot serve as an LLM provider`)
  return factory(secretFor(row, 'api_key', deps)).languageModel(modelId)
}

export function resolveModelWithDefaults(db: Db, deps: EngineDeps, agentDef: Agent) {
  const settings = buildSettings(agentDef)
  return wrapLanguageModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ai-sdk provider type drifts across adapter versions
    model: resolveModel(db, deps, agentDef.connection_id, agentDef.model) as any,
    middleware: defaultSettingsMiddleware({ settings }),
  })
}

function buildSettings(agentDef: Agent): Parameters<typeof defaultSettingsMiddleware>[0]['settings'] {
  const settings: Parameters<typeof defaultSettingsMiddleware>[0]['settings'] = { maxOutputTokens: agentDef.max_tokens }
  if (agentDef.temperature !== null) settings.temperature = agentDef.temperature
  if (agentDef.reasoning_budget !== null) {
    settings.providerOptions = {
      anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
    }
  }
  return settings
}
