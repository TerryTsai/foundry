// Internal CRUD helpers — entity writes that the runtime (engine,
// reconciler, sandbox) needs without ownership checks. Route handlers
// use the ownership-aware helpers in the per-entity files; these are
// for the composition root to wire into deps bags.
//
// Naming reflects the cross-module callback shape: `<entity><Verb>` so
// the deps interface reads like `crud.sessionUpdate`, `crud.activityCreate`.

import { type Db } from '@foundry/db'
import type { Activity, Agent, Connection, Project, Session, Ticket } from '@foundry/db'

import * as database from './repo.js'

// ── ticket ───────────────────────────────────────────────────────────

export function ticketGetById(db: Db, id: string): Ticket | undefined {
  return database.ticketGet(db, id)
}

export function ticketTransition(
  db: Db, id: string, from: string, to: string,
): boolean {
  return database.ticketTransition(db, id, from, to)
}

export function ticketUpdateById(
  db: Db, id: string, data: Record<string, unknown>,
): Ticket {
  return database.ticketUpdate(db, id, data)
}

export function ticketAllByProject(
  db: Db, projectId: string, status: string,
): Ticket[] {
  // Inline the (project_id, status) filter conditions so callers don't
  // need drizzle imports.
  return ticketsByProjectAndStatus(db, projectId, status)
}

function ticketsByProjectAndStatus(db: Db, projectId: string, status: string): Ticket[] {
  return database.ticketAllByProjectStatus(db, projectId, status)
}

// ── project ──────────────────────────────────────────────────────────

export function projectGetById(db: Db, id: string): Project | undefined {
  return database.projectGet(db, id)
}

export function projectsActive(db: Db): Project[] {
  return database.projectsActive(db)
}

// ── session ──────────────────────────────────────────────────────────

export function sessionGetById(db: Db, id: string): Session | undefined {
  return database.sessionGet(db, id)
}

export function sessionUpdateById(
  db: Db, id: string, data: Record<string, unknown>,
): Session {
  return database.sessionUpdate(db, id, data)
}

export function sessionInsert(
  db: Db, data: Record<string, unknown>,
): Session {
  return database.sessionInsert(db, data)
}

export function sessionRunning(db: Db): Session[] {
  return database.sessionRunning(db)
}

export function sessionRunningForTicket(db: Db, ticketId: string): Session[] {
  return database.sessionRunningForTicket(db, ticketId)
}

export function sessionsByTicketRaw(db: Db, ticketId: string): Session[] {
  return database.sessionsByTicketRaw(db, ticketId)
}

// ── activity ─────────────────────────────────────────────────────────

export function activityCreate(
  db: Db, data: Record<string, unknown>,
): Activity {
  return database.activityInsert(db, data)
}

export function activityUpdate(
  db: Db, id: string, data: Record<string, unknown>,
): Activity {
  return database.activityUpdate(db, id, data)
}

export function activityByTurnOrder(
  db: Db, sessionId: string, turnId: string, orderIndex: number,
): Activity | undefined {
  return database.activityByTurnOrder(db, sessionId, turnId, orderIndex)
}

// ── agent ────────────────────────────────────────────────────────────

export function agentGetById(db: Db, id: string): Agent | undefined {
  return database.agentGet(db, id)
}

// ── connection ───────────────────────────────────────────────────────

export function connectionGetById(db: Db, id: string): Connection | undefined {
  return database.connectionGet(db, id)
}

export function connectionByAccount(db: Db, accountId: string): Connection[] {
  return database.connectionByAccount(db, accountId)
}

export function connectionUpdateById(
  db: Db, id: string, data: Record<string, unknown>,
): Connection {
  return database.connectionUpdate(db, id, data)
}

// ── account ──────────────────────────────────────────────────────────

export function accountGetById(db: Db, id: string) {
  return database.accountGet(db, id)
}

// ── verdict ──────────────────────────────────────────────────────────

export function verdictBySession(db: Db, sessionId: string) {
  return database.verdictBySession(db, sessionId)
}

export function verdictByTicket(db: Db, ticketId: string) {
  return database.verdictByTicket(db, ticketId)
}

// ── auth-session ─────────────────────────────────────────────────────

export function authSessionGet(db: Db, id: string) {
  return database.authSessionGet(db, id)
}

export function authSessionInsert(
  db: Db, data: { id: string; account_id: string; created_at: string; expires_at: string },
) {
  return database.authSessionInsert(db, data)
}

export function authSessionRemove(db: Db, id: string): void {
  database.authSessionRemove(db, id)
}

// ── account upsert (auth login) ──────────────────────────────────────

export function accountUpsertByGithubId(db: Db, data: {
  github_id:  number
  login:      string
  name:       string | null
  email:      string | null
  avatar_url: string | null
}) {
  return database.accountUpsertByGithubId(db, data)
}

export function claimUnownedProjects(db: Db, ownerLogin: string): number {
  return database.claimUnownedProjects(db, ownerLogin)
}

// ── comment ──────────────────────────────────────────────────────────

export function commentByTicket(db: Db, ticketId: string) {
  return database.commentByTicket(db, ticketId)
}
