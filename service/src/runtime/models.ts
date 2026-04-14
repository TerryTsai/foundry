import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

// Flat table of model factories per provider kind. The Vercel AI SDK
// path uses these; the Claude Agent SDK path (kind 'anthropic-subscription')
// bypasses model factories entirely — its token is consumed by the
// subscription runner instead.

export type ModelFactory = (apiKey: string) => { languageModel: (id: string) => unknown }

export const anthropicModel: ModelFactory = (apiKey) =>
  createAnthropic({ apiKey }) as unknown as { languageModel: (id: string) => unknown }

export const openaiModel: ModelFactory = (apiKey) =>
  createOpenAI({ apiKey }) as unknown as { languageModel: (id: string) => unknown }

export const modelFactoryByKind: Record<string, ModelFactory | undefined> = {
  anthropic: anthropicModel,
  openai:    openaiModel,
}
