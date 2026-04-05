import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const sandboxRuns = sqliteTable('sandbox_runs', {
  id: text('id').primaryKey(),
  session_id: text('session_id'),
  image: text('image').notNull(),
  command: text('command').notNull(),
  status: text('status').notNull().default('running'),
  exit_code: integer('exit_code'),
  started_at: text('started_at').notNull(),
  ended_at: text('ended_at'),
})

export type SandboxRun = typeof sandboxRuns.$inferSelect
