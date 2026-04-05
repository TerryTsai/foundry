import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentDefinitions = sqliteTable('agent_definitions', {
  id: text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  image: text('image').notNull(),
  env: text('env').notNull().default('[]'),  // JSON: string[]
  created_at: text('created_at').notNull(),
})

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  ticket_id: text('ticket_id').notNull(),
  agent_def_id: text('agent_def_id').notNull().references(() => agentDefinitions.id),
  status: text('status').notNull().default('running'),
  started_at: text('started_at').notNull(),
  ended_at: text('ended_at'),
})

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => agentSessions.id),
  role: text('role').notNull(),   // 'user' | 'assistant' | 'founder'
  content: text('content').notNull(),
  created_at: text('created_at').notNull(),
})

export type AgentDefinition = typeof agentDefinitions.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
export type AgentMessage = typeof agentMessages.$inferSelect
