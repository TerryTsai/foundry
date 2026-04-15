import { eq } from 'drizzle-orm'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import { now } from '../util.js'
import { ticketList, ticketClaim } from './tickets.js'
import { agentList } from './agents.js'
import { sessionStartedComment } from './sessions.js'

export async function schedulerDispatch(db: Db, projectId: string): Promise<void> {
  const proj = database.projectGet(db, projectId)
  if (!proj || proj.status !== 'active') return

  const opened  = ticketList(db, { projectId, status: 'opened' })
  const claimed = ticketList(db, { projectId, status: 'claimed' })
  const agents  = agentList(db, { accountId: proj.owner_id })

  if (claimed.length >= proj.max_agents) return

  const eligible = opened.filter(t => {
    if (!t.agent_id || !agents.find(a => a.id === t.agent_id)) return false
    // Dependency gate: skip tickets whose dependency hasn't finished yet.
    // "Blocked" is derived — not stored. A pending ticket with an unmet
    // dependency just isn't dispatchable.
    if (t.depends_on) {
      const dep = database.ticketGet(db, t.depends_on)
      if (!dep || dep.status !== 'resolved' || dep.outcome !== 'finished') return false
    }
    return true
  })

  for (const t of eligible.slice(0, proj.max_agents - claimed.length)) {
    const def = agents.find(a => a.id === t.agent_id)!
    // Atomic claim — if another dispatcher beat us, skip rather than
    // double-spawn.
    if (!ticketClaim(db, t.id)) continue

    const row = database.sessionInsert(db, {
      ticket_id: t.id, agent_id: def.id,
      status: 'running', started_at: now(),
    })
    sessionStartedComment(db, t.id, def.name, row.id)

    const { runAgentSession } = await import('../runtime/runner-ai.js')
    const { config } = await import('../config.js')
    runAgentSession(db, config, row.id, def, t).catch((err: unknown) =>
      console.error('dispatch session error:', err))
  }
}

export async function schedulerRecover(db: Db): Promise<void> {
  // Stale claimed tickets (orphaned by a server restart or crashed session)
  // get released back to opened. Any 'running' session rows attached to
  // those stale tickets are failed. 5-minute fixed cutoff.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  for (const proj of database.projectAll(db)) {
    for (const t of ticketList(db, { projectId: proj.id, status: 'claimed' })) {
      if (t.claimed_at && t.claimed_at < cutoff) {
        const sessions = database.sessionAll(db, [
          eq(schema.session.ticket_id, t.id),
          eq(schema.session.status, 'running'),
        ])
        for (const s of sessions) {
          database.sessionUpdate(db, s.id, {
            status: 'failed', ended_at: now(),
            error: 'recovered: ticket stale, session presumed dead',
          })
        }
        database.ticketUpdate(db, t.id, { status: 'opened', claimed_at: null, updated_at: now() })
      }
    }
  }
}

let globalInterval: ReturnType<typeof setInterval> | null = null

export function schedulerGlobalStart(db: Db): void {
  if (globalInterval) return
  globalInterval = setInterval(() => {
    for (const proj of database.projectAll(db, [eq(schema.project.status, 'active')])) {
      schedulerDispatch(db, proj.id).catch((err: unknown) =>
        console.error(`dispatch error for project ${proj.id}:`, err))
    }
  }, 5000)
}

// Stop the global dispatch loop. Called from SIGTERM so no new sessions
// spawn while we drain in-flight work.
export function schedulerStopAll(): void {
  if (globalInterval) { clearInterval(globalInterval); globalInterval = null }
}

// Fail all in-flight sessions and release their tickets. Called from SIGTERM
// so deploys don't leave zombie rows.
export function shutdownDrain(db: Db): void {
  const running = database.sessionAll(db, [eq(schema.session.status, 'running')])
  for (const s of running) {
    database.sessionUpdate(db, s.id, {
      status: 'failed', error: 'deploy-restart', ended_at: now(),
    })
    const t = database.ticketGet(db, s.ticket_id)
    if (t?.status === 'claimed') {
      database.ticketUpdate(db, t.id, { status: 'opened', claimed_at: null, updated_at: now() })
    }
  }
  if (running.length) console.log(`drained ${running.length} running session(s)`)
}
