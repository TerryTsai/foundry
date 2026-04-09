import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

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

export const provider = sqliteTable('provider', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull().unique(),
  api_key:    text('api_key').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export type Provider = typeof provider.$inferSelect
export type NewProvider = typeof provider.$inferInsert

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

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

export const comment = sqliteTable('comment', {
  id:         text('id').primaryKey(),
  ticket_id:  text('ticket_id').notNull().references(() => ticket.id),
  session_id: text('session_id'),
  author:     text('author').notNull(),
  body:       text('body').notNull(),
  created_at: text('created_at').notNull(),
})

export type Comment = typeof comment.$inferSelect

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export const agent = sqliteTable('agent', {
  id:          text('id').primaryKey(),
  project_id:  text('project_id').notNull(),
  name:        text('name').notNull(),
  model:       text('model').notNull(),
  prompt:      text('prompt').notNull(),
  max_tokens:  integer('max_tokens').notNull().default(8192),
  max_steps:   integer('max_steps').notNull().default(20),
  temperature: real('temperature'),
  tools:       text('tools'),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Agent = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert

export const session = sqliteTable('session', {
  id:            text('id').primaryKey(),
  ticket_id:     text('ticket_id').notNull(),
  agent_id:      text('agent_id').notNull().references(() => agent.id),
  status:        text('status').notNull().default('running'),
  model:         text('model').notNull(),
  system_prompt: text('system_prompt'),
  error:         text('error'),
  tokens_in:     integer('tokens_in'),
  tokens_out:    integer('tokens_out'),
  cost_usd:      real('cost_usd'),
  duration_ms:   integer('duration_ms'),
  step_count:    integer('step_count'),
  tool_calls:    integer('tool_calls'),
  finish_reason: text('finish_reason'),
  started_at:    text('started_at').notNull(),
  ended_at:      text('ended_at'),
})

export type Session = typeof session.$inferSelect

export const message = sqliteTable('message', {
  id:         text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => session.id),
  role:       text('role').notNull(),
  content:    text('content').notNull(),
  tokens:     integer('tokens'),
  tokens_in:  integer('tokens_in'),
  created_at: text('created_at').notNull(),
})

export type Message = typeof message.$inferSelect

export const execution = sqliteTable('execution', {
  id:              text('id').primaryKey(),
  session_id:      text('session_id'),
  tool_name:       text('tool_name'),
  command:         text('command').notNull(),
  status:          text('status').notNull().default('running'),
  exit_code:       integer('exit_code'),
  exit_signal:     text('exit_signal'),
  stdout:          text('stdout'),
  stderr:          text('stderr'),
  duration_ms:     integer('duration_ms'),
  timeout_ms:      integer('timeout_ms').notNull(),
  memory_mb:       integer('memory_mb'),
  peak_memory_mb:  real('peak_memory_mb'),
  cpu_ms:          integer('cpu_ms'),
  net_rx_bytes:    integer('net_rx_bytes'),
  net_tx_bytes:    integer('net_tx_bytes'),
  started_at:      text('started_at').notNull(),
  ended_at:        text('ended_at'),
})

export type Execution = typeof execution.$inferSelect

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

// (No dedicated tables — files are served from bare git repos on disk)
