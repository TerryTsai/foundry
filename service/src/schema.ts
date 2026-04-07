import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ── Agent Definitions ──

export const agentDefinitions = sqliteTable('agent_definitions', {
  id:         text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  name:       text('name').notNull(),
  prompt:     text('prompt').notNull(),
  image:      text('image').notNull(),
  env:        text('env').notNull().default('[]'),
  created_at: text('created_at').notNull(),
})

export type AgentDefinition = typeof agentDefinitions.$inferSelect
export type NewAgentDefinition = typeof agentDefinitions.$inferInsert

// ── Agent Messages ──

export const agentMessages = sqliteTable('agent_messages', {
  id:         text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => agentSessions.id),
  role:       text('role').notNull(),
  content:    text('content').notNull(),
  created_at: text('created_at').notNull(),
})

export type AgentMessage = typeof agentMessages.$inferSelect

// ── Agent Sessions ──

export const agentSessions = sqliteTable('agent_sessions', {
  id:           text('id').primaryKey(),
  ticket_id:    text('ticket_id').notNull(),
  agent_def_id: text('agent_def_id').notNull().references(() => agentDefinitions.id),
  status:       text('status').notNull().default('running'),
  started_at:   text('started_at').notNull(),
  ended_at:     text('ended_at'),
})

export type AgentSession = typeof agentSessions.$inferSelect

// ── Projects ──

export const projects = sqliteTable('projects', {
  id:                text('id').primaryKey(),
  name:              text('name').notNull(),
  slug:              text('slug').notNull().unique(),
  status:            text('status').notNull().default('active'),
  workspace:         text('workspace').notNull(),
  schedule_interval: integer('schedule_interval').notNull().default(600),
  concurrency_limit: integer('concurrency_limit').notNull().default(3),
  created_at:        text('created_at').notNull(),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

// ── Sandbox Runs ──

export const sandboxRuns = sqliteTable('sandbox_runs', {
  id:         text('id').primaryKey(),
  session_id: text('session_id'),
  image:      text('image').notNull(),
  command:    text('command').notNull(),
  status:     text('status').notNull().default('running'),
  exit_code:  integer('exit_code'),
  started_at: text('started_at').notNull(),
  ended_at:   text('ended_at'),
})

export type SandboxRun = typeof sandboxRuns.$inferSelect

// ── Tickets ──

export const tickets = sqliteTable('tickets', {
  id:         text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  title:      text('title').notNull(),
  body:       text('body').notNull(),
  agent:      text('agent').notNull(),
  status:     text('status').notNull().default('open'),
  parent_id:  text('parent_id'),
  notes:      text('notes'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  claimed_at: text('claimed_at'),
})

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
