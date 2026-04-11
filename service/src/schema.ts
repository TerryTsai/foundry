import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

export const account = sqliteTable('account', {
  id:         text('id').primaryKey(),
  github_id:  integer('github_id').notNull().unique(),
  login:      text('login').notNull(),
  name:       text('name'),
  email:      text('email'),
  avatar_url: text('avatar_url'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export type Account = typeof account.$inferSelect

// Cookie value is the row id; rows are deleted on logout/expiry. No HMAC needed.
export const authSession = sqliteTable('auth_session', {
  id:         text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => account.id, { onDelete: 'cascade' }),
  created_at: text('created_at').notNull(),
  expires_at: text('expires_at').notNull(),
})

export type AuthSession = typeof authSession.$inferSelect

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

// repo is "owner/repo" — the GitHub repo each session clones from. owner_id
// default '' lets the runtime backfill claim legacy rows on first login.
export const project = sqliteTable('project', {
  id:                text('id').primaryKey(),
  owner_id:          text('owner_id').notNull().default('').references(() => account.id),
  repo:              text('repo').notNull().default(''),
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
  type:       text('type').notNull(),
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
  id:               text('id').primaryKey(),
  project_id:       text('project_id').notNull(),
  provider_id:      text('provider_id').notNull().references(() => provider.id),
  name:             text('name').notNull(),
  model:            text('model').notNull(),
  prompt:           text('prompt').notNull(),
  max_tokens:       integer('max_tokens').notNull().default(8192),
  max_steps:        integer('max_steps').notNull().default(20),
  temperature:      real('temperature'),
  reasoning_budget: integer('reasoning_budget'),
  tools:            text('tools'),
  created_at:       text('created_at').notNull(),
  updated_at:       text('updated_at').notNull(),
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
  cost_usd:      real('cost_usd'),
  duration_ms:   integer('duration_ms'),
  finish_reason: text('finish_reason'),
  started_at:    text('started_at').notNull(),
  ended_at:      text('ended_at'),
})

export type Session = typeof session.$inferSelect

export const message = sqliteTable('message', {
  id:              text('id').primaryKey(),
  session_id:      text('session_id').notNull().references(() => session.id),
  role:            text('role').notNull(),
  content:         text('content').notNull(),
  tokens:          integer('tokens'),
  tokens_in:       integer('tokens_in'),
  tool_call_count: integer('tool_call_count'),
  created_at:      text('created_at').notNull(),
})

export type Message = typeof message.$inferSelect

export const execution = sqliteTable('execution', {
  id:              text('id').primaryKey(),
  session_id:      text('session_id'),
  tool_name:       text('tool_name'),
  tool_input:      text('tool_input'),
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

// ════════════════════════════════════════════════════════════════════════════
