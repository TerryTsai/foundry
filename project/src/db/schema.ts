import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('active'),
  workspace: text('workspace').notNull(),
  schedule_interval: integer('schedule_interval').notNull().default(600),
  concurrency_limit: integer('concurrency_limit').notNull().default(3),
  created_at: text('created_at').notNull(),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
