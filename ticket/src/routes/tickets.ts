import { Router } from 'express'
import { eq, and, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { tickets } from '../db/schema.js'
import type Database from 'better-sqlite3'

const VALID_STATUSES = ['open', 'claimed', 'done', 'failed', 'blocked'] as const
type Status = (typeof VALID_STATUSES)[number]

export function ticketRouter(db: Db, sqlite: Database.Database) {
  const router = Router()

  // GET /ticket
  router.get('/', (req, res) => {
    const { projectId, agent, status, parentId } = req.query

    const conditions = []
    if (projectId) conditions.push(eq(tickets.project_id, projectId as string))
    if (agent) conditions.push(eq(tickets.agent, agent as string))
    if (status) conditions.push(eq(tickets.status, status as string))
    if (parentId === 'null') {
      conditions.push(isNull(tickets.parent_id))
    } else if (parentId) {
      conditions.push(eq(tickets.parent_id, parentId as string))
    }

    const rows = conditions.length
      ? db.select().from(tickets).where(and(...conditions)).all()
      : db.select().from(tickets).all()

    res.json(rows)
  })

  // POST /ticket
  router.post('/', (req, res) => {
    const body = z.object({
      project_id: z.string(),
      title: z.string(),
      body: z.string(),
      agent: z.string(),
      parent_id: z.string().optional(),
      created_by: z.string(),
      block: z.boolean().optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const { project_id, title, body: ticketBody, agent, parent_id, created_by, block } = body.data

    // Validate parent exists if provided
    if (parent_id) {
      const parent = db.select().from(tickets).where(eq(tickets.id, parent_id)).get()
      if (!parent) {
        res.status(400).json({ error: 'parent_id not found' })
        return
      }
    }

    const id = nanoid()
    const now = new Date().toISOString()

    const createAndMaybeBlock = sqlite.transaction(() => {
      db.insert(tickets).values({
        id,
        project_id,
        title,
        body: ticketBody,
        agent,
        status: 'open',
        parent_id: parent_id ?? null,
        created_by,
        created_at: now,
      }).run()

      if (block && parent_id) {
        const parent = db.select().from(tickets).where(eq(tickets.id, parent_id)).get()
        if (parent && parent.status === 'claimed') {
          db.update(tickets)
            .set({ status: 'blocked' })
            .where(eq(tickets.id, parent_id))
            .run()
        }
      }
    })

    createAndMaybeBlock()

    const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
    res.status(201).json(ticket)
  })

  // GET /ticket/:id
  router.get('/:id', (req, res) => {
    const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    if (!ticket) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(ticket)
  })

  // GET /ticket/:id/chain
  router.get('/:id/chain', (req, res) => {
    const chain: typeof tickets.$inferSelect[] = []
    let current = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()

    if (!current) {
      res.status(404).json({ error: 'not found' })
      return
    }

    // Walk up to root
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      chain.unshift(current)
      if (!current.parent_id) break
      current = db.select().from(tickets).where(eq(tickets.id, current.parent_id)).get()
    }

    res.json(chain.map(t => ({
      id: t.id,
      title: t.title,
      body: t.body,
      notes: t.notes,
      agent: t.agent,
      status: t.status,
    })))
  })

  // PUT /ticket/:id
  router.put('/:id', (req, res) => {
    const body = z.object({
      body: z.string().optional(),
      notes: z.string().optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    if (!ticket) {
      res.status(404).json({ error: 'not found' })
      return
    }

    const updates: Partial<typeof tickets.$inferInsert> = {}
    if (body.data.body !== undefined) updates.body = body.data.body
    if (body.data.notes !== undefined) updates.notes = body.data.notes

    if (Object.keys(updates).length === 0) {
      res.json(ticket)
      return
    }

    db.update(tickets).set(updates).where(eq(tickets.id, req.params.id)).run()
    const updated = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    res.json(updated)
  })

  // POST /ticket/:id/claim
  router.post('/:id/claim', (req, res) => {
    const claim = sqlite.transaction(() => {
      const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
      if (!ticket) return { status: 404, body: { error: 'not found' } }
      if (ticket.status !== 'open') return { status: 409, body: { error: `cannot claim ticket with status '${ticket.status}'` } }

      const now = new Date().toISOString()
      db.update(tickets)
        .set({ status: 'claimed', claimed_at: now })
        .where(eq(tickets.id, req.params.id))
        .run()

      const updated = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
      return { status: 200, body: updated }
    })

    const result = claim()
    res.status(result.status).json(result.body)
  })

  // POST /ticket/:id/done
  router.post('/:id/done', (req, res) => {
    const body = z.object({ notes: z.string().optional() }).safeParse(req.body)
    const notes = body.success ? body.data.notes : undefined

    const done = sqlite.transaction(() => {
      const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
      if (!ticket) return { status: 404, body: { error: 'not found' } }
      if (ticket.status !== 'claimed') return { status: 409, body: { error: `cannot mark done from status '${ticket.status}'` } }

      db.update(tickets)
        .set({ status: 'done', ...(notes !== undefined ? { notes } : {}) })
        .where(eq(tickets.id, req.params.id))
        .run()

      // Unblock parent if it was blocked waiting on this ticket
      if (ticket.parent_id) {
        const parent = db.select().from(tickets).where(eq(tickets.id, ticket.parent_id)).get()
        if (parent && parent.status === 'blocked') {
          db.update(tickets)
            .set({ status: 'open' })
            .where(eq(tickets.id, ticket.parent_id))
            .run()
        }
      }

      const updated = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
      return { status: 200, body: updated }
    })

    const result = done()
    res.status(result.status).json(result.body)
  })

  // POST /ticket/:id/fail
  router.post('/:id/fail', (req, res) => {
    const body = z.object({ notes: z.string().optional() }).safeParse(req.body)
    const notes = body.success ? body.data.notes : undefined

    const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    if (!ticket) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (ticket.status !== 'claimed') {
      res.status(409).json({ error: `cannot fail ticket with status '${ticket.status}'` })
      return
    }

    db.update(tickets)
      .set({ status: 'failed', ...(notes !== undefined ? { notes } : {}) })
      .where(eq(tickets.id, req.params.id))
      .run()

    const updated = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    res.json(updated)
  })

  // POST /ticket/:id/reopen
  router.post('/:id/reopen', (req, res) => {
    const ticket = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    if (!ticket) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (ticket.status !== 'failed') {
      res.status(409).json({ error: `cannot reopen ticket with status '${ticket.status}'` })
      return
    }

    db.update(tickets)
      .set({ status: 'open', claimed_at: null })
      .where(eq(tickets.id, req.params.id))
      .run()

    const updated = db.select().from(tickets).where(eq(tickets.id, req.params.id)).get()
    res.json(updated)
  })

  return router
}
