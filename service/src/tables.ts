import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

export const account = sqliteTable('account', {
  id:          text('id').primaryKey(),
  github_id:   integer('github_id').notNull().unique(),
  login:       text('login').notNull(),
  name:        text('name'),
  email:       text('email'),
  avatar_url:  text('avatar_url'),
  // Founder-level context. Prepended to every session's system prompt so
  // the crew carries the founder's working style / preferences into
  // whatever they're doing. Keep short; the per-project + per-agent
  // descriptions carry the specifics.
  description: text('description').notNull().default(''),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Account = typeof account.$inferSelect

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

export const project = sqliteTable('project', {
  id:          text('id').primaryKey(),
  owner_id:    text('owner_id').notNull().default('').references(() => account.id),
  repo:        text('repo').notNull().default(''),
  name:        text('name').notNull(),
  description: text('description').notNull().default(''),
  status:      text('status').notNull().default('active'),
  max_agents:  integer('max_agents').notNull().default(3),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Project = typeof project.$inferSelect
export type NewProject = typeof project.$inferInsert

// Unified "connection": anything with credentials the account owns.
// kind  = 'anthropic' | 'anthropic-subscription' | future 'openai' | 'github' | …
// config  = non-secret settings
// secrets = credential material; never serialized to tool inputs or
//           execution rows.
export const connection = sqliteTable('connection', {
  id:         text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => account.id),
  kind:       text('kind').notNull(),
  name:       text('name').notNull(),
  config:     text('config').notNull().default('{}'),
  secrets:    text('secrets').notNull().default('{}'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export type Connection = typeof connection.$inferSelect
export type NewConnection = typeof connection.$inferInsert

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

// State machine:
//   created ──▶ waiting ──▶ running ──▶ finished
//                  ▲           │         failed
//                  └───────────┘         cancelled
//
// Statuses: created | waiting | running | finished | failed | cancelled
// "blocked" is derived: a ticket is dispatchable iff status = created AND
// (depends_on IS NULL OR depends_on.status = 'finished').
export const ticket = sqliteTable('ticket', {
  id:          text('id').primaryKey(),
  project_id:  text('project_id').notNull(),
  agent_id:    text('agent_id'),
  title:       text('title').notNull(),
  description: text('description').notNull(),
  status:      text('status').notNull().default('created'),
  priority:    integer('priority').notNull().default(0),
  depends_on:  text('depends_on'),
  created_by:  text('created_by').notNull(),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Ticket = typeof ticket.$inferSelect
export type NewTicket = typeof ticket.$inferInsert

export const tag = sqliteTable('tag', {
  id:         text('id').primaryKey(),
  ticket_id:  text('ticket_id').notNull().references(() => ticket.id, { onDelete: 'cascade' }),
  tag:        text('tag').notNull(),
  created_at: text('created_at').notNull(),
})

export type Tag = typeof tag.$inferSelect

export const comment = sqliteTable('comment', {
  id:         text('id').primaryKey(),
  ticket_id:  text('ticket_id').notNull().references(() => ticket.id),
  session_id: text('session_id'),
  author:     text('author').notNull(),
  body:       text('body').notNull(),            // narrative stream; flows into prompt context
  created_at: text('created_at').notNull(),
})

export type Comment = typeof comment.$inferSelect

// ════════════════════════════════════════════════════════════════════════════
// AGENT (immutable; edit = insert new row, set superseded_at on prior)
// ════════════════════════════════════════════════════════════════════════════

export const agent = sqliteTable('agent', {
  id:               text('id').primaryKey(),
  account_id:       text('account_id').notNull().references(() => account.id),
  connection_id:    text('connection_id').notNull().references(() => connection.id),
  name:             text('name').notNull(),
  description:      text('description').notNull(),
  model:            text('model').notNull(),
  max_tokens:       integer('max_tokens').notNull().default(8192),
  max_steps:        integer('max_steps').notNull().default(20),
  temperature:      real('temperature'),
  reasoning_budget: integer('reasoning_budget'),
  tools:            text('tools'),                 // JSON: McpToolSelection
  verifiers:        text('verifiers'),             // JSON: agent_id[] — agents that review this producer's resolve(finished)
  // Set when a newer version supersedes this row. NULL = current.
  // Enforces immutability at the application layer: agentUpdate inserts a
  // new row (new id) and writes superseded_at on the prior row.
  // A partial unique index — UNIQUE (account_id, name) WHERE superseded_at
  // IS NULL — keeps "current by name" honest without blocking history.
  superseded_at:    text('superseded_at'),
  created_at:       text('created_at').notNull(),
})

export type Agent = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert

// ════════════════════════════════════════════════════════════════════════════
// SESSION + ACTIVITY + EXECUTION
// ════════════════════════════════════════════════════════════════════════════

export const session = sqliteTable('session', {
  id:            text('id').primaryKey(),
  ticket_id:     text('ticket_id').notNull(),
  agent_id:      text('agent_id').notNull().references(() => agent.id),
  // Final assembled system prompt at dispatch (account + project + agent
  // + ticket + comment stream). Stored so historical sessions are
  // reproducible even after prompt layers change.
  system_prompt: text('system_prompt'),
  status:        text('status').notNull().default('running'),
  error:         text('error'),
  cost_usd:      real('cost_usd'),
  duration_ms:   integer('duration_ms'),
  started_at:    text('started_at').notNull(),
  ended_at:      text('ended_at'),
})

export type Session = typeof session.$inferSelect

// Flat event log. One row per block the model emitted, one row per
// execution correlation. No container for "the turn" — the turn is
// recovered by grouping on turn_id (the BetaMessage.id).
//
// Kinds:
//   prompt    — founder's initial ticket input
//   thought   — assistant 'thinking' block
//   said      — assistant 'text' block
//   tool_call — assistant 'tool_use' block; execution_id is REQUIRED
//               for new rows (enforced by domain layer). Historical
//               rows from before the correlation column may have NULL.
//   reconcile — system modelUsage delta at session close
//
// Tokens: the full turn's input/output totals sit on the FIRST activity
// of each turn (lowest order_index for a turn_id). Others carry NULL
// for tokens_in/tokens. Sum across activities equals modelUsage exactly.
export const activity = sqliteTable('activity', {
  id:           text('id').primaryKey(),
  session_id:   text('session_id').notNull().references(() => session.id),
  turn_id:      text('turn_id'),                    // BetaMessage.id; groups a turn's blocks
  kind:         text('kind').notNull(),
  order_index:  integer('order_index').notNull().default(0),
  payload:      text('payload').notNull(),          // JSON, shape per kind
  tool_use_id:  text('tool_use_id'),                // required for kind='tool_call'
  execution_id: text('execution_id'),               // required for kind='tool_call' (new rows)
  tokens_in:    integer('tokens_in'),
  tokens:       integer('tokens'),
  created_at:   text('created_at').notNull(),
})

export type Activity = typeof activity.$inferSelect
export type NewActivity = typeof activity.$inferInsert

export const execution = sqliteTable('execution', {
  id:              text('id').primaryKey(),
  session_id:      text('session_id'),
  tool_name:       text('tool_name'),
  tool_input:      text('tool_input'),
  tool_use_id:     text('tool_use_id'),            // 'toolu_…' — correlates to an activity row
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
// VERDICT — verifier pass/fail reports
// ════════════════════════════════════════════════════════════════════════════
// Written by a verifier session via the verdictReport MCP tool. One row per
// verifier-session; the verifier dance reads these to decide whether to
// finish a ticket or reopen it. Rounds are recovered by ordering sessions
// on the ticket by started_at (producer → verifier… → next producer).
export const verdict = sqliteTable('verdict', {
  id:         text('id').primaryKey(),
  ticket_id:  text('ticket_id').notNull().references(() => ticket.id),
  session_id: text('session_id').notNull().references(() => session.id),
  agent_id:   text('agent_id').notNull().references(() => agent.id),
  pass:       integer('pass', { mode: 'boolean' }).notNull(),
  reason:     text('reason').notNull().default(''),
  created_at: text('created_at').notNull(),
})

export type Verdict = typeof verdict.$inferSelect
export type NewVerdict = typeof verdict.$inferInsert

// ════════════════════════════════════════════════════════════════════════════
// EVENT — append-only audit log for all state transitions
// ════════════════════════════════════════════════════════════════════════════

export const event = sqliteTable('event', {
  id:           text('id').primaryKey(),
  entity_type:  text('entity_type').notNull(),    // ticket | session | execution
  entity_id:    text('entity_id').notNull(),
  kind:         text('kind').notNull(),            // created, status_changed, etc.
  data:         text('data').notNull().default('{}'),
  caused_by:    text('caused_by').notNull(),       // founder | agent | reconciler | runtime
  caused_by_id: text('caused_by_id'),
  created_at:   text('created_at').notNull(),
})

export type Event = typeof event.$inferSelect
