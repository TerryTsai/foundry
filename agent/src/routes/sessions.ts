import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { agentDefinitions, agentSessions, agentMessages } from '../db/schema.js'

type SessionRunner = (
  db: Db,
  sessionId: string,
  agentDef: typeof agentDefinitions.$inferSelect,
  ticket: TicketData,
  deps: SessionDeps,
) => Promise<void>

interface TicketData {
  id: string
  project_id: string
  title: string
  body: string
  agent: string
  status: string
}

interface SessionDeps {
  ticketUrl: string
  sandboxUrl: string
  repoUrl: string
}

export function sessionsRouter(db: Db, deps: SessionDeps, runSession: SessionRunner) {
  const router = Router({ mergeParams: true })

  // POST /agent/:id/session
  router.post('/', async (req, res) => {
    const body = z.object({ ticket_id: z.string() }).safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const agentDef = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).get()
    if (!agentDef) {
      res.status(404).json({ error: 'agent definition not found' })
      return
    }

    const { ticket_id } = body.data

    // Claim the ticket atomically — abort if race
    const claimRes = await fetch(`${deps.ticketUrl}/ticket/${ticket_id}/claim`, { method: 'POST' })
    if (!claimRes.ok) {
      const err = await claimRes.json() as { error?: string }
      res.status(409).json({ error: err.error ?? 'failed to claim ticket' })
      return
    }

    // Fetch ticket data
    const ticketRes = await fetch(`${deps.ticketUrl}/ticket/${ticket_id}`)
    if (!ticketRes.ok) {
      res.status(500).json({ error: 'failed to fetch ticket' })
      return
    }
    const ticket = await ticketRes.json() as TicketData

    const sessionId = nanoid()
    db.insert(agentSessions).values({
      id: sessionId,
      ticket_id,
      agent_def_id: agentDef.id,
      status: 'running',
      started_at: new Date().toISOString(),
    }).run()

    // Fire and forget
    runSession(db, sessionId, agentDef, ticket, deps).catch((err: unknown) => {
      console.error(`session ${sessionId} crashed:`, err)
    })

    const session = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
    res.status(201).json(session)
  })

  // GET /agent/:id/session/:sid
  router.get('/:sid', (req, res) => {
    const session = db.select().from(agentSessions).where(eq(agentSessions.id, req.params.sid)).get()
    if (!session) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(session)
  })

  // GET /agent/:id/session/:sid/status
  router.get('/:sid/status', (req, res) => {
    const session = db.select().from(agentSessions).where(eq(agentSessions.id, req.params.sid)).get()
    if (!session) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json({ status: session.status })
  })

  // DELETE /agent/:id/session/:sid — kill session
  router.delete('/:sid', (req, res) => {
    const session = db.select().from(agentSessions).where(eq(agentSessions.id, req.params.sid)).get()
    if (!session) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (session.status !== 'running') {
      res.status(409).json({ error: `session is not running (status: ${session.status})` })
      return
    }
    db.update(agentSessions)
      .set({ status: 'failed', ended_at: new Date().toISOString() })
      .where(eq(agentSessions.id, req.params.sid))
      .run()
    res.json({ ok: true })
  })

  // POST /agent/:id/session/:sid/message — founder injects a message
  router.post('/:sid/message', (req, res) => {
    const body = z.object({ content: z.string().min(1) }).safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const session = db.select().from(agentSessions).where(eq(agentSessions.id, req.params.sid)).get()
    if (!session) {
      res.status(404).json({ error: 'not found' })
      return
    }

    const id = nanoid()
    db.insert(agentMessages).values({
      id,
      session_id: req.params.sid,
      role: 'founder',
      content: body.data.content,
      created_at: new Date().toISOString(),
    }).run()

    const msg = db.select().from(agentMessages).where(eq(agentMessages.id, id)).get()
    res.status(201).json(msg)
  })

  // GET /agent/:id/session/:sid/message — list messages
  router.get('/:sid/message', (req, res) => {
    const session = db.select().from(agentSessions).where(eq(agentSessions.id, req.params.sid)).get()
    if (!session) {
      res.status(404).json({ error: 'not found' })
      return
    }
    const msgs = db.select().from(agentMessages).where(eq(agentMessages.session_id, req.params.sid)).all()
    res.json(msgs)
  })

  return router
}
