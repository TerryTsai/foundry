import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ── Agent ──

export const agent = sqliteTable('agent', {
  id:         text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  name:       text('name').notNull(),
  model:      text('model').notNull(),
  prompt:     text('prompt').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export type Agent = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert

// ── Comment ──

export const comment = sqliteTable('comment', {
  id:         text('id').primaryKey(),
  ticket_id:  text('ticket_id').notNull().references(() => ticket.id),
  author:     text('author').notNull(),
  body:       text('body').notNull(),
  created_at: text('created_at').notNull(),
})

export type Comment = typeof comment.$inferSelect

// ── Execution ──

export const execution = sqliteTable('execution', {
  id:          text('id').primaryKey(),
  session_id:  text('session_id'),
  command:     text('command').notNull(),
  status:      text('status').notNull().default('running'),
  exit_code:   integer('exit_code'),
  stdout:      text('stdout'),
  stderr:      text('stderr'),
  duration_ms: integer('duration_ms'),
  timeout_ms:  integer('timeout_ms').notNull(),
  memory_mb:   integer('memory_mb'),
  started_at:  text('started_at').notNull(),
  ended_at:    text('ended_at'),
})

export type Execution = typeof execution.$inferSelect

// ── Message ──

export const message = sqliteTable('message', {
  id:         text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => session.id),
  role:       text('role').notNull(),
  content:    text('content').notNull(),
  tokens:     integer('tokens'),
  created_at: text('created_at').notNull(),
})

export type Message = typeof message.$inferSelect

// ── Project ──

export const project = sqliteTable('project', {
  id:                text('id').primaryKey(),
  name:              text('name').notNull(),
  status:            text('status').notNull().default('active'),
  schedule_interval: integer('schedule_interval').notNull().default(600),
  concurrency_limit: integer('concurrency_limit').notNull().default(3),
  created_at:        text('created_at').notNull(),
  updated_at:        text('updated_at').notNull(),
})

export type Project = typeof project.$inferSelect
export type NewProject = typeof project.$inferInsert

// ── Session ──

export const session = sqliteTable('session', {
  id:          text('id').primaryKey(),
  ticket_id:   text('ticket_id').notNull(),
  agent_id:    text('agent_id').notNull().references(() => agent.id),
  status:      text('status').notNull().default('running'),
  model:       text('model').notNull(),
  error:       text('error'),
  tokens_in:   integer('tokens_in'),
  tokens_out:  integer('tokens_out'),
  cost_usd:    real('cost_usd'),
  duration_ms: integer('duration_ms'),
  started_at:  text('started_at').notNull(),
  ended_at:    text('ended_at'),
})

export type Session = typeof session.$inferSelect

// ── Ticket ──

export const ticket = sqliteTable('ticket', {
  id:         text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  agent_id:   text('agent_id'),
  title:      text('title').notNull(),
  body:       text('body').notNull(),
  status:     text('status').notNull().default('open'),
  priority:   integer('priority').notNull().default(0),
  parent_id:  text('parent_id'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  claimed_at: text('claimed_at'),
})

export type Ticket = typeof ticket.$inferSelect
export type NewTicket = typeof ticket.$inferInsert
