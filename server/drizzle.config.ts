import type { Config } from 'drizzle-kit'

export default {
  // Schema lives in @foundry/db now (Phase 4 migration). drizzle-kit
  // accepts a path; resolve it relative to this config file.
  schema: '../db/src/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? './foundry.db',
  },
} satisfies Config
