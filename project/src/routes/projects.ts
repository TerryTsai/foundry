import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { projects } from '../db/schema.js'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface ProjectHooks {
  triggerDispatch: (projectId: string) => Promise<void>
  onProjectCreated: (projectId: string, intervalSeconds: number) => void
  onProjectPaused: (projectId: string) => void
  onProjectResumed: (projectId: string, intervalSeconds: number) => void
}

export function projectRouter(db: Db, hooks: ProjectHooks) {
  const router = Router()

  // GET /project
  router.get('/', (req, res) => {
    const { status } = req.query
    const rows = status
      ? db.select().from(projects).where(eq(projects.status, status as string)).all()
      : db.select().from(projects).all()
    res.json(rows)
  })

  // POST /project
  router.post('/', (req, res) => {
    const body = z.object({
      name: z.string().min(1),
      workspace: z.string().min(1),
      schedule_interval: z.number().int().positive().optional(),
      concurrency_limit: z.number().int().positive().optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const { name, workspace, schedule_interval = 600, concurrency_limit = 3 } = body.data
    const slug = slugify(name)

    const existing = db.select().from(projects).where(eq(projects.slug, slug)).get()
    if (existing) {
      res.status(409).json({ error: `slug '${slug}' already exists` })
      return
    }

    const id = nanoid()
    const now = new Date().toISOString()

    db.insert(projects).values({
      id,
      name,
      slug,
      status: 'active',
      workspace,
      schedule_interval,
      concurrency_limit,
      created_at: now,
    }).run()

    hooks.onProjectCreated(id, schedule_interval)

    const project = db.select().from(projects).where(eq(projects.id, id)).get()
    res.status(201).json(project)
  })

  // GET /project/:id
  router.get('/:id', (req, res) => {
    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(project)
  })

  // PUT /project/:id
  router.put('/:id', (req, res) => {
    const body = z.object({
      name: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      status: z.enum(['active', 'paused']).optional(),
      schedule_interval: z.number().int().positive().optional(),
      concurrency_limit: z.number().int().positive().optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) {
      res.status(404).json({ error: 'not found' })
      return
    }

    const { name, workspace, status, schedule_interval, concurrency_limit } = body.data
    const updates: Partial<typeof projects.$inferInsert> = {}
    if (name !== undefined) {
      updates.name = name
      updates.slug = slugify(name)
    }
    if (workspace !== undefined) updates.workspace = workspace
    if (status !== undefined) updates.status = status
    if (schedule_interval !== undefined) updates.schedule_interval = schedule_interval
    if (concurrency_limit !== undefined) updates.concurrency_limit = concurrency_limit

    if (Object.keys(updates).length === 0) {
      res.json(project)
      return
    }

    db.update(projects).set(updates).where(eq(projects.id, req.params.id)).run()
    const updated = db.select().from(projects).where(eq(projects.id, req.params.id)).get()!

    // Handle scheduler changes
    if (status === 'paused') hooks.onProjectPaused(project.id)
    if (status === 'active' && project.status === 'paused') {
      hooks.onProjectResumed(project.id, updated.schedule_interval)
    }
    if (schedule_interval !== undefined && updated.status === 'active') {
      hooks.onProjectResumed(project.id, updated.schedule_interval)
    }

    res.json(updated)
  })

  // POST /project/:id/run — trigger immediate dispatch
  router.post('/:id/run', (req, res) => {
    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (project.status !== 'active') {
      res.status(409).json({ error: 'project is paused' })
      return
    }

    hooks.triggerDispatch(project.id).catch((err: unknown) => {
      console.error(`dispatch error for project ${project.id}:`, err)
    })

    res.status(202).json({ ok: true })
  })

  return router
}
