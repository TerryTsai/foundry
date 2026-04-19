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
  // JSON array of lowercased label strings. Replaces the standalone
  // tag table — at this scale (one founder, hundreds of tickets) the
  // JSON column is simpler than a junction table without losing
  // anything that's actually queried.
  tags:        text('tags').notNull().default('[]'),
  created_by:  text('created_by').notNull(),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Ticket = typeof ticket.$inferSelect
export type NewTicket = typeof ticket.$inferInsert

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
  id:             text('id').primaryKey(),
  ticket_id:      text('ticket_id').notNull(),
  agent_id:       text('agent_id').notNull().references(() => agent.id),
  status:         text('status').notNull().default('running'),
  error:          text('error'),
  cost_usd:       real('cost_usd'),
  duration_ms:    integer('duration_ms'),
  // Verifier-only. Producer sessions always leave these NULL. Written
  // by the verdictReport tool (or the synthetic-fail pipeline when a
  // verifier ends silently or crashes). One verdict per verifier
  // session — a column fits the 1:1 cardinality cleanly.
  verdict_pass:   integer('verdict_pass', { mode: 'boolean' }),
  verdict_reason: text('verdict_reason'),
  started_at:     text('started_at').notNull(),
  ended_at:       text('ended_at'),
})

export type Session = typeof session.$inferSelect

// Flat event log. One row per block the model emitted, one row per
// execution correlation, plus verifier verdicts. No container for "the
// turn" — the turn is recovered by grouping on turn_id (the
// BetaMessage.id).
//
// Kinds:
//   prompt    — founder's initial ticket input
//   thought   — assistant 'thinking' block
//   said      — assistant 'text' block
//   tool_call — assistant 'tool_use' block; execution_id is REQUIRED
//               for new rows (enforced by service layer). Historical
//               rows from before the correlation column may have NULL.
//   reconcile — system modelUsage delta at session close
//   (Verdicts live on session.verdict_pass / session.verdict_reason,
//   not as an activity row.)
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

// Note: tool_use_id was duplicated here and on activity. The activity
// row already carries tool_use_id, and execution_id on activity links
// the two. One direction is enough — execution → activity is via the
// execution_id back-reference if you need it.
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
