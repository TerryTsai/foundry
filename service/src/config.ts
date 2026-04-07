import { z } from 'zod'

const schema = z.object({
  port:            z.coerce.number().int().default(3000),
  dbPath:          z.string().default('./foundry.db'),
  repoBase:        z.string().default('/home/terry/repos'),
  sandboxImage:    z.string().default('node:20-alpine'),
  sandboxTimeout:  z.coerce.number().int().default(300000),
})

export const config = schema.parse({
  port:           process.env.PORT,
  dbPath:         process.env.DB_PATH,
  repoBase:       process.env.REPO_BASE,
  sandboxImage:   process.env.SANDBOX_IMAGE,
  sandboxTimeout: process.env.SANDBOX_TIMEOUT,
})

export type Config = typeof config
