import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import { type Db } from '../../database.js'
import * as database from '../../database.js'
import type { Agent as AgentDef } from '../../tables.js'
import { mustExist } from '../../util.js'
import { badRequest } from '../../errors.js'
import { decryptSecret } from '../../crypto/secrets.js'

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

function secretFor(conn: { secrets: string }, field: string): string {
  try {
    const parsed = JSON.parse(decryptSecret(conn.secrets)) as Record<string, unknown>
    const v = parsed[field]
    if (typeof v !== 'string' || !v) throw new Error(`missing ${field}`)
    return v
  } catch (err) {
    throw badRequest(`connection secrets invalid: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function resolveModel(db: Db, connectionId: string, modelId: string) {
  const row = mustExist(database.connectionGet(db, connectionId), `connection '${connectionId}' not found`)
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
