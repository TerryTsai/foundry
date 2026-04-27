import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai'

import type { Agent } from '@foundry/db'
import { decryptSecret } from '@foundry/crypto'

import type { SessionContext, WrappedModel } from '../schema.js'

// Resolve a connection-bound LLM client. The Claude Agent SDK path
// (kind 'anthropic-subscription') bypasses this entirely; its token is
// consumed by the anthropic loop directly. New providers add a branch
// in resolveModel below — registering a factory map at module scope is
// forbidden (no module-level state in feature files).

function secretFor(conn: { secrets: string }, field: string, key: Buffer): string {
  const parsed = parseSecrets(conn.secrets, key)
  const v = parsed[field]
  if (typeof v !== 'string' || !v) throw new Error(`connection secrets invalid: missing ${field}`)
  return v
}

function parseSecrets(blob: string, key: Buffer): Record<string, unknown> {
  try {
    return JSON.parse(decryptSecret(blob, key)) as Record<string, unknown>
  } catch (errVal) {
    throw new Error(`connection secrets invalid: ${errVal instanceof Error ? errVal.message : String(errVal)}`)
  }
}

export async function resolveModel(ctx: SessionContext, connectionId: string, modelId: string): Promise<unknown> {
  const r = await ctx.crud.connectionGetById(ctx.ctx, connectionId)
  if (!r.ok)   throw new Error(`connection '${connectionId}' lookup failed: ${r.error.kind}`)
  if (!r.value) throw new Error(`connection '${connectionId}' not found`)
  const row = r.value
  const apiKey = secretFor(row, 'api_key', ctx.encryptionKey)
  if (row.kind === 'anthropic') return createAnthropic({ apiKey }).languageModel(modelId)
  if (row.kind === 'openai')    return createOpenAI({ apiKey }).languageModel(modelId)
  throw new Error(`connection kind '${row.kind}' has no model factory — cannot serve as an LLM provider`)
}

export async function resolveModelWithDefaults(ctx: SessionContext, agentDef: Agent) {
  const settings = buildSettings(agentDef)
  return wrapLanguageModel({
    model: (await resolveModel(ctx, agentDef.connection_id, agentDef.model)) as unknown as WrappedModel,
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
