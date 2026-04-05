import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb } from '../helpers/db.js'
import { projectRouter } from '../../routes/projects.js'

function buildApp(triggerDispatch = vi.fn().mockResolvedValue(undefined)) {
  const { db } = createTestDb()
  const app = express()
  app.use(express.json())
  const hooks = {
    triggerDispatch,
    onProjectCreated: vi.fn(),
    onProjectPaused: vi.fn(),
    onProjectResumed: vi.fn(),
  }
  app.use('/project', projectRouter(db, hooks))
  return { app, dispatch: triggerDispatch, hooks }
}

const base = { name: 'My Project', workspace: '/repos/my-project.git' }

describe('POST /project', () => {
  it('creates a project with defaults', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/project').send(base)
    expect(res.status).toBe(201)
    expect(res.body.slug).toBe('my-project')
    expect(res.body.status).toBe('active')
    expect(res.body.schedule_interval).toBe(600)
    expect(res.body.concurrency_limit).toBe(3)
  })

  it('accepts custom schedule_interval and concurrency_limit', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/project').send({ ...base, schedule_interval: 300, concurrency_limit: 5 })
    expect(res.status).toBe(201)
    expect(res.body.schedule_interval).toBe(300)
    expect(res.body.concurrency_limit).toBe(5)
  })

  it('returns 400 for missing required fields', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/project').send({ name: 'No workspace' })
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate slug', async () => {
    const { app } = buildApp()
    await request(app).post('/project').send(base)
    const res = await request(app).post('/project').send(base)
    expect(res.status).toBe(409)
  })

  it('slugifies the name', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/project').send({ ...base, name: '  Hello World!  ' })
    expect(res.status).toBe(201)
    expect(res.body.slug).toBe('hello-world')
  })
})

describe('GET /project', () => {
  it('lists all projects', async () => {
    const { app } = buildApp()
    await request(app).post('/project').send(base)
    await request(app).post('/project').send({ ...base, name: 'Other', workspace: '/repos/other.git' })
    const res = await request(app).get('/project')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('filters by status', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    await request(app).put(`/project/${created.body.id}`).send({ status: 'paused' })
    const active = await request(app).get('/project?status=active')
    expect(active.body).toHaveLength(0)
    const paused = await request(app).get('/project?status=paused')
    expect(paused.body).toHaveLength(1)
  })
})

describe('GET /project/:id', () => {
  it('returns a project', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    const res = await request(app).get(`/project/${created.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('My Project')
  })

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp()
    const res = await request(app).get('/project/nope')
    expect(res.status).toBe(404)
  })
})

describe('PUT /project/:id', () => {
  it('updates name and re-slugifies', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    const res = await request(app).put(`/project/${created.body.id}`).send({ name: 'Renamed Project' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Renamed Project')
    expect(res.body.slug).toBe('renamed-project')
  })

  it('updates status to paused', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    const res = await request(app).put(`/project/${created.body.id}`).send({ status: 'paused' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('paused')
  })

  it('returns 400 for invalid status', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    const res = await request(app).put(`/project/${created.body.id}`).send({ status: 'deleted' })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp()
    const res = await request(app).put('/project/nope').send({ status: 'paused' })
    expect(res.status).toBe(404)
  })
})

describe('POST /project/:id/run', () => {
  it('triggers dispatch and returns 202', async () => {
    const triggerDispatch = vi.fn().mockResolvedValue(undefined)
    const { app } = buildApp(triggerDispatch)
    const dispatch = triggerDispatch
    const created = await request(app).post('/project').send(base)
    const res = await request(app).post(`/project/${created.body.id}/run`)
    expect(res.status).toBe(202)
    // dispatch is fire-and-forget, give it a tick
    await new Promise(r => setTimeout(r, 10))
    expect(dispatch).toHaveBeenCalledWith(created.body.id)
  })

  it('returns 404 for unknown project', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/project/nope/run')
    expect(res.status).toBe(404)
  })

  it('returns 409 for paused project', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/project').send(base)
    await request(app).put(`/project/${created.body.id}`).send({ status: 'paused' })
    const res = await request(app).post(`/project/${created.body.id}/run`)
    expect(res.status).toBe(409)
  })
})
