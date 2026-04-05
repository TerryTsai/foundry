import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  agent: text('agent').notNull(),
  status: text('status').notNull().default('open'),
  parent_id: text('parent_id'),
  notes: text('notes'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  claimed_at: text('claimed_at'),
})

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
