import { Router } from 'express'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { agentDefinitions } from '../db/schema.js'

export function definitionsRouter(db: Db) {
  const router = Router()

  // GET /agent
  router.get('/', (req, res) => {
    const { projectId } = req.query
    const rows = projectId
      ? db.select().from(agentDefinitions).where(eq(agentDefinitions.project_id, projectId as string)).all()
      : db.select().from(agentDefinitions).all()
    res.json(rows)
  })

  // POST /agent
  router.post('/', (req, res) => {
    const body = z.object({
      project_id: z.string(),
      name: z.string().min(1),
      prompt: z.string().min(1),
      image: z.string().min(1),
      env: z.array(z.string()).optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const { project_id, name, prompt, image, env = [] } = body.data

    // Enforce unique(project_id, name)
    const existing = db.select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.project_id, project_id), eq(agentDefinitions.name, name)))
      .get()
    if (existing) {
      res.status(409).json({ error: `agent '${name}' already exists in project '${project_id}'` })
      return
    }

    const id = nanoid()
    db.insert(agentDefinitions).values({
      id,
      project_id,
      name,
      prompt,
      image,
      env: JSON.stringify(env),
      created_at: new Date().toISOString(),
    }).run()

    const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()
    res.status(201).json(def)
  })

  // GET /agent/:id
  router.get('/:id', (req, res) => {
    const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).get()
    if (!def) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(def)
  })

  // PUT /agent/:id
  router.put('/:id', (req, res) => {
    const body = z.object({
      prompt: z.string().min(1).optional(),
      image: z.string().min(1).optional(),
      env: z.array(z.string()).optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).get()
    if (!def) {
      res.status(404).json({ error: 'not found' })
      return
    }

    const updates: Partial<typeof agentDefinitions.$inferInsert> = {}
    if (body.data.prompt !== undefined) updates.prompt = body.data.prompt
    if (body.data.image !== undefined) updates.image = body.data.image
    if (body.data.env !== undefined) updates.env = JSON.stringify(body.data.env)

    if (Object.keys(updates).length > 0) {
      db.update(agentDefinitions).set(updates).where(eq(agentDefinitions.id, req.params.id)).run()
    }

    const updated = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).get()
    res.json(updated)
  })

  // DELETE /agent/:id
  router.delete('/:id', (req, res) => {
    const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).get()
    if (!def) {
      res.status(404).json({ error: 'not found' })
      return
    }
    db.delete(agentDefinitions).where(eq(agentDefinitions.id, req.params.id)).run()
    res.json({ ok: true })
  })

  return router
}
