import type { Db } from './db/client.js'
import { projects } from './db/schema.js'
import { eq } from 'drizzle-orm'

interface Ticket {
  id: string
  agent: string
  status: string
  claimed_at: string | null
}

interface AgentDef {
  id: string
  name: string
}

export interface SchedulerDeps {
  ticketUrl: string
  agentUrl: string
}

export async function dispatch(db: Db, projectId: string, deps: SchedulerDeps): Promise<void> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project || project.status !== 'active') return

  const [openRes, claimedRes, agentDefsRes] = await Promise.all([
    fetch(`${deps.ticketUrl}/ticket?projectId=${projectId}&status=open`),
    fetch(`${deps.ticketUrl}/ticket?projectId=${projectId}&status=claimed`),
    fetch(`${deps.agentUrl}/agent?projectId=${projectId}`),
  ])

  if (!openRes.ok || !claimedRes.ok || !agentDefsRes.ok) return

  const open = await openRes.json() as Ticket[]
  const claimed = await claimedRes.json() as Ticket[]
  const agentDefs = await agentDefsRes.json() as AgentDef[]

  if (claimed.length >= project.concurrency_limit) return

  const slots = project.concurrency_limit - claimed.length
  const toDispatch = open.slice(0, slots)

  for (const ticket of toDispatch) {
    const agentDef = agentDefs.find(a => a.name === ticket.agent)
    if (!agentDef) continue
    fetch(`${deps.agentUrl}/agent/${agentDef.id}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticket.id }),
    }).catch((err: unknown) => console.error('dispatch session start error:', err))
  }
}

export async function recoverStalledTickets(db: Db, deps: SchedulerDeps): Promise<void> {
  const allProjects = db.select().from(projects).all()
  for (const project of allProjects) {
    const threshold = project.schedule_interval * 3 * 1000
    const cutoff = new Date(Date.now() - threshold).toISOString()

    const claimedRes = await fetch(
      `${deps.ticketUrl}/ticket?projectId=${project.id}&status=claimed`
    )
    if (!claimedRes.ok) continue

    const claimed = await claimedRes.json() as Ticket[]
    for (const ticket of claimed) {
      if (ticket.claimed_at && ticket.claimed_at < cutoff) {
        fetch(`${deps.ticketUrl}/ticket/${ticket.id}/reopen`, { method: 'POST' })
          .catch((err: unknown) => console.error('stall recovery error:', err))
      }
    }
  }
}

// Per-project interval tracking
const intervals = new Map<string, ReturnType<typeof setInterval>>()

export function scheduleProject(db: Db, projectId: string, intervalSeconds: number, deps: SchedulerDeps): void {
  clearProjectSchedule(projectId)
  const timer = setInterval(
    () => dispatch(db, projectId, deps).catch((err: unknown) =>
      console.error(`dispatch error for project ${projectId}:`, err)
    ),
    intervalSeconds * 1000
  )
  intervals.set(projectId, timer)
}

export function clearProjectSchedule(projectId: string): void {
  const existing = intervals.get(projectId)
  if (existing) {
    clearInterval(existing)
    intervals.delete(projectId)
  }
}

export function startAllSchedulers(db: Db, deps: SchedulerDeps): void {
  const active = db.select().from(projects).where(eq(projects.status, 'active')).all()
  for (const project of active) {
    scheduleProject(db, project.id, project.schedule_interval, deps)
  }
}

export function stopAllSchedulers(): void {
  for (const [id, timer] of intervals) {
    clearInterval(timer)
    intervals.delete(id)
  }
}
