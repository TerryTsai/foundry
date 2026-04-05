import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { EventEmitter } from 'events'
import type { Db } from '../db/client.js'
import { sandboxRuns } from '../db/schema.js'
import type { RunOptions } from '../runner.js'

// In-memory map of running containers: run_id → { emitter, kill }
const activeRuns = new Map<string, { emitter: EventEmitter; kill: () => void }>()

type Spawn = (opts: RunOptions) => { emitter: EventEmitter; kill: () => void }

export function sandboxRouter(db: Db, spawn: Spawn, timeoutMs = 5 * 60 * 1000) {
  const router = Router()

  // GET /sandbox — list recent runs
  router.get('/', (_req: Request, res: Response) => {
    const runs = db.select().from(sandboxRuns)
      .orderBy(sandboxRuns.started_at)
      .all()
      .reverse()
      .slice(0, 200)
    res.json(runs)
  })

  // POST /sandbox
  router.post('/', (req: Request, res: Response) => {
    const body = z.object({
      image: z.string().min(1),
      command: z.string().min(1),
      workspace: z.string().min(1),
      session_id: z.string().optional(),
      env: z.record(z.string()).optional(),
      network: z.boolean().optional(),
    }).safeParse(req.body)

    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const { image, command, workspace, session_id, env = {}, network = false } = body.data

    const id = nanoid()
    const now = new Date().toISOString()

    db.insert(sandboxRuns).values({
      id,
      session_id: session_id ?? null,
      image,
      command,
      status: 'running',
      started_at: now,
    }).run()

    const handle = spawn({ image, command, workspace, env, network, timeoutMs })
    activeRuns.set(id, handle)

    handle.emitter.on('exit', (code: number) => {
      const ended = new Date().toISOString()
      const status = code === 0 ? 'done' : 'failed'
      db.update(sandboxRuns)
        .set({ status, exit_code: code, ended_at: ended })
        .where(eq(sandboxRuns.id, id))
        .run()
      activeRuns.delete(id)
    })

    res.status(201).json({ id })
  })

  // GET /sandbox/:id
  router.get('/:id', (req: Request, res: Response) => {
    const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, req.params.id)).get()
    if (!run) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(run)
  })

  // DELETE /sandbox/:id
  router.delete('/:id', (req: Request, res: Response) => {
    const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, req.params.id)).get()
    if (!run) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (run.status !== 'running') {
      res.status(409).json({ error: `run is not active (status: ${run.status})` })
      return
    }

    const handle = activeRuns.get(req.params.id)
    if (handle) {
      handle.kill()
      activeRuns.delete(req.params.id)
    }

    const ended = new Date().toISOString()
    db.update(sandboxRuns)
      .set({ status: 'failed', exit_code: -1, ended_at: ended })
      .where(eq(sandboxRuns.id, req.params.id))
      .run()

    res.json({ ok: true })
  })

  // GET /sandbox/:id/output — SSE stream
  router.get('/:id/output', (req: Request, res: Response) => {
    const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, req.params.id)).get()
    if (!run) {
      res.status(404).json({ error: 'not found' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // If already done, send exit immediately
    if (run.status !== 'running') {
      send('exit', { code: run.exit_code ?? -1 })
      res.end()
      return
    }

    const handle = activeRuns.get(req.params.id)
    if (!handle) {
      send('exit', { code: -1 })
      res.end()
      return
    }

    const onStdout = (line: string) => send('stdout', { line })
    const onStderr = (line: string) => send('stderr', { line })
    const onExit = (code: number) => {
      send('exit', { code })
      res.end()
    }

    handle.emitter.on('stdout', onStdout)
    handle.emitter.on('stderr', onStderr)
    handle.emitter.once('exit', onExit)

    req.on('close', () => {
      handle.emitter.off('stdout', onStdout)
      handle.emitter.off('stderr', onStderr)
      handle.emitter.off('exit', onExit)
    })
  })

  return router
}
