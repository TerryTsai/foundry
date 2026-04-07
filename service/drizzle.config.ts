import type { Config } from 'drizzle-kit'

export default {
  schema: './src/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? './foundry.db',
  },
} satisfies Config
