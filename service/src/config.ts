import { z } from 'zod'

const schema = z.object({
  port:            z.coerce.number().int().default(3000),
  dbPath:          z.string().default('./foundry.db'),
  repoBase:        z.string().default('/home/terry/repos'),
  anthropicKey:    z.string().default(''),
  agentModel:      z.string().default('claude-sonnet-4-20250514'),
  sandboxImage:    z.string().default('node:20-alpine'),
  sandboxTimeout:  z.coerce.number().int().default(300000),
})

export const config = schema.parse({
  port:           process.env.PORT,
  dbPath:         process.env.DB_PATH,
  repoBase:       process.env.REPO_BASE,
  anthropicKey:   process.env.ANTHROPIC_API_KEY,
  agentModel:     process.env.AGENT_MODEL,
  sandboxImage:   process.env.SANDBOX_IMAGE,
  sandboxTimeout: process.env.SANDBOX_TIMEOUT,
})

export type Config = typeof config
