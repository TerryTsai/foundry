// Middleware types and composition. A session runs as a Koa-style onion:
// each middleware does setup, awaits next(ctx), then tears down. The
// innermost layer is the atomic agent-loop invocation.

import { type Db } from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket, Session } from '../tables.js'

export interface LoopResult {
  finishReason: string | null
  tokensIn:     number
  tokensOut:    number
  toolCalls:    number
  costUsd:      number
  cancelled:    boolean
}

export interface SessionContext {
  db:           Db
  config:       Config
  session:      Session
  ticket:       Ticket
  agent:        AgentDef
  systemPrompt: string
  userPrompt:   string
  workDir:      string
  shouldStop:   () => boolean
  result?:      LoopResult
  startedAt:    number
}

export type SessionStep = (ctx: SessionContext) => Promise<SessionContext>
export type Middleware  = (next: SessionStep) => SessionStep

// Compose middleware around a base step. The first middleware listed is
// the outermost onion layer (sees the whole call including downstream
// throws); the last is closest to the base step.
export const use = (...mws: Middleware[]) => (base: SessionStep): SessionStep =>
  mws.reduceRight((next, mw) => mw(next), base)
