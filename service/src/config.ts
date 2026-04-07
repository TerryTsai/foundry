export const config = {
  port:            parseInt(process.env.PORT ?? '3000', 10),
  dbPath:          process.env.DB_PATH ?? './foundry.db',
  repoBase:        process.env.REPO_BASE ?? '/home/terry/repos',
  anthropicKey:    process.env.ANTHROPIC_API_KEY ?? '',
  agentModel:      process.env.AGENT_MODEL ?? 'claude-sonnet-4-20250514',
  sandboxImage:    process.env.SANDBOX_IMAGE ?? 'node:20-alpine',
  sandboxTimeout:  parseInt(process.env.SANDBOX_TIMEOUT ?? '300000', 10),
}

export type Config = typeof config
