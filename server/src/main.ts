import express, { type NextFunction, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { authRoutes, requireAccount } from './auth.js'
import { config } from './config.js'
import { listCommitsForPath } from './github.js'
import { createLocalState } from './local-state.js'
import { taskStatuses } from './schema.js'
import { createWorkspaceWorker } from './worker.js'
import {
  accessibleRepositories, createTask, discoverProjects, enableRepository,
  findProject, patchProjectConfig, patchTask, steer,
} from './workspace.js'

const taskPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  guidance: z.array(z.string().max(2000)).max(50).optional(),
  current: z.array(z.string().max(2000)).max(50).optional(),
  next: z.string().max(20_000).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  nextEligibleAt: z.string().datetime().nullable().optional(),
  nextTask: z.string().max(100).nullable().optional(),
})

export function buildApp() {
  const localState = createLocalState(config.statePath)
  const worker = createWorkspaceWorker(config, localState)
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/auth', authRoutes(config, localState))
  app.use('/api', requireAccount(config, localState))

  app.get('/api/workspace', asyncRoute(async (req, res) => {
    const projects = await discoverProjects(req.foundryAccount!.token, config)
    res.json({ projects, settings: localState.settings(), worker: worker.state() })
  }))
  app.get('/api/repositories', asyncRoute(async (req, res) => {
    res.json(await accessibleRepositories(req.foundryAccount!.token, config))
  }))
  app.post('/api/repositories/enable', asyncRoute(async (req, res) => {
    const body = z.object({ repo: z.string().regex(/^[^/]+\/[^/]+$/), branch: z.string().min(1) }).parse(req.body)
    await enableRepository(req.foundryAccount!.token, body.repo, body.branch, { type: config.sandboxRuntime, image: config.sandboxImage })
    res.status(201).json({ ok: true })
  }))
  app.patch('/api/workspace/settings', asyncRoute(async (req, res) => {
    const current = localState.settings()
    const patch = z.object({ frequency: z.enum(['manual', '15m', '30m', '1h', '4h']).optional(), paused: z.boolean().optional() }).parse(req.body)
    localState.saveSettings({ ...current, ...patch })
    res.json(localState.settings())
  }))
  app.post('/api/worker/run', asyncRoute(async (req, res) => {
    void worker.runNow(req.foundryAccount)
    res.status(202).json(worker.state())
  }))
  app.get('/api/projects/:owner/:repo', asyncRoute(async (req, res) => {
    res.json(await projectFromRequest(req, true))
  }))
  app.patch('/api/projects/:owner/:repo', asyncRoute(async (req, res) => {
    const project = await projectFromRequest(req, true)
    const patch = z.object({ enabled: z.boolean().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }).parse(req.body)
    await patchProjectConfig(req.foundryAccount!.token, project, patch)
    res.json({ ok: true })
  }))
  app.post('/api/projects/:owner/:repo/tasks', asyncRoute(async (req, res) => {
    const project = await projectFromRequest(req, true)
    const body = z.object({ title: z.string().min(1).max(200), description: z.string().min(1).max(20_000), start: z.boolean().default(false) }).parse(req.body)
    res.status(201).json(await createTask(req.foundryAccount!.token, project, body.title, body.description, body.start))
  }))
  app.patch('/api/projects/:owner/:repo/tasks/:taskId', asyncRoute(async (req, res) => {
    const project = await projectFromRequest(req, true)
    const body = taskPatch.parse(req.body)
    res.json(await patchTask(req.foundryAccount!.token, project, requestParam(req, 'taskId'), {
      ...body,
      nextEligibleAt: body.nextEligibleAt || undefined,
      nextTask: body.nextTask || undefined,
    }))
  }))
  app.post('/api/projects/:owner/:repo/steer', asyncRoute(async (req, res) => {
    const project = await projectFromRequest(req, true)
    const body = z.object({ message: z.string().min(1).max(10_000), taskId: z.string().optional() }).parse(req.body)
    res.json(await steer(req.foundryAccount!.token, project, body.taskId, body.message))
  }))
  app.get('/api/projects/:owner/:repo/tasks/:taskId/history', asyncRoute(async (req, res) => {
    const project = await projectFromRequest(req)
    const task = project.tasks.find(item => item.id === requestParam(req, 'taskId'))
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json(await listCommitsForPath(req.foundryAccount!.token, project.id, task.path))
  }))

  serveSite(app)
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error)
    const status = error instanceof z.ZodError ? 400 : /not found/i.test(message) ? 404 : 500
    if (status === 500) console.error(error)
    res.status(status).json({ error: message })
  })
  return { app, worker, localState }
}

export function boot() {
  const built = buildApp()
  const server = built.app.listen(config.port, () => {
    console.log(`Foundry listening on http://localhost:${config.port}`)
    built.worker.start()
  })
  const shutdown = () => {
    built.worker.stop()
    server.close(() => { built.localState.close(); process.exit(0) })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return server
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { handler(req, res).catch(next) }
}

function projectFromRequest(req: Request, fresh = false) {
  return findProject(req.foundryAccount!.token, config, requestParam(req, 'owner'), requestParam(req, 'repo'), fresh)
}

function requestParam(req: Request, name: string): string {
  return z.string().parse(req.params[name])
}

function serveSite(app: express.Express): void {
  const directory = dirname(fileURLToPath(import.meta.url))
  const site = join(directory, '../../site/dist')
  if (!existsSync(site)) return
  app.use(express.static(site))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path === '/health') return next()
    res.sendFile(join(site, 'index.html'))
  })
}
